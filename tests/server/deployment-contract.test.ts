import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');

describe('deployment contract', () => {
  it('serializes deploys and has atomic release, rollback, and commit attestation guards', () => {
    const script = readFileSync(join(repoRoot, 'scripts/create-release.sh'), 'utf8');
    expect(script).toContain('+refs/heads/*:refs/remotes/origin/*');
    expect(script).toContain("awk 'NF == 1 { print $1; exit }'");
    expect(script).toContain('shlock -f "$LOCK_FILE" -p "$$"');
    expect(script).toContain('LOCK_FILE="/tmp/com.contexgin.server.$(id -u).deploy.lock"');
    expect(script).not.toContain('LOCK_FILE="$RELEASE_ROOT');
    expect(script).toContain("trap 'exit 130' INT TERM HUP");
    expect(script).toContain('mktemp -d "$RELEASE_ROOT/.build.XXXXXX"');
    expect(script).toContain('CUTOVER_ACTIVE=1');
    expect(script).toContain('h.deploymentCommit!==process.argv[2]');
    expect(script).toContain(
      '[ "$(dist_sha256 "$RELEASE_DIR")" = "$(cat "$RELEASE_DIR/.dist.sha256")" ]',
    );
    expect(script).toContain('curl -fsS --connect-timeout 2 --max-time 5');
  });

  it('rejects an overlapping invocation before touching Git or launchd', () => {
    const home = mkdtempSync(join(tmpdir(), 'contexgin-deploy-lock-'));
    const releases = join(home, 'releases');
    mkdirSync(releases, { recursive: true });
    writeFileSync(join(releases, '.deploy.lock'), `${process.pid}\n`);
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'shlock'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, 'shlock'), 0o755);
    const result = spawnSync('bash', [join(repoRoot, 'scripts/create-release.sh')], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        CONTEXGIN_RELEASE_ROOT: releases,
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('another ContexGin deployment is active');
  });

  it('rejects staged source drift and modified generated artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'contexgin-start-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'dist'));
    cpSync(join(repoRoot, 'scripts/start.sh'), join(root, 'scripts/start.sh'));
    writeFileSync(join(root, 'tracked.txt'), 'clean\n');
    writeFileSync(join(root, 'dist/cli.js'), 'clean\n');
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: root });
    execFileSync('git', ['checkout', '--detach'], { cwd: root });
    const digest = execFileSync(
      'bash',
      [
        '-c',
        "find dist -type f -exec shasum -a 256 {} \\; | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'",
      ],
      { cwd: root, encoding: 'utf8' },
    ).trim();
    writeFileSync(join(root, '.dist.sha256'), `${digest}\n`);
    execFileSync('git', ['add', '.dist.sha256'], { cwd: root });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'digest'], { cwd: root });
    const pinned = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();

    writeFileSync(join(root, 'tracked.txt'), 'staged\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    let result = spawnSync('bash', [join(root, 'scripts/start.sh')], {
      env: { ...process.env, CONTEXGIN_DEPLOYMENT_COMMIT: pinned },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('tracked modifications');

    execFileSync('git', ['restore', '--staged', 'tracked.txt'], { cwd: root });
    execFileSync('git', ['restore', 'tracked.txt'], { cwd: root });
    writeFileSync(join(root, 'dist/cli.js'), 'tampered\n');
    result = spawnSync('bash', [join(root, 'scripts/start.sh')], {
      env: { ...process.env, CONTEXGIN_DEPLOYMENT_COMMIT: pinned },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('build artifacts do not match');
  });
});
