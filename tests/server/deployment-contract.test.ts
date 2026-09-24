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
    expect(script).toContain('refs/heads/$REMOTE_BRANCH:refs/remotes/origin/$REMOTE_BRANCH');
    expect(script).toContain('"$SOURCE_COMMIT" "refs/remotes/origin/$REMOTE_BRANCH"');
    expect(script).toContain('scripts/render-launchd-plist.py');
    expect(script).toContain('shlock -f "$LOCK_FILE" -p "$$"');
    expect(script).toContain('LOCK_FILE="/tmp/com.contexgin.server.$(id -u).deploy.lock"');
    expect(script).not.toContain('LOCK_FILE="$RELEASE_ROOT');
    expect(script).toContain("trap 'exit 130' INT TERM HUP");
    expect(script).toContain('mktemp -d "$RELEASE_ROOT/.build.XXXXXX"');
    expect(script).toContain('CUTOVER_ACTIVE=1');
    expect(script).toContain('h.deploymentCommit!==process.argv[2]');
    expect(script).toContain(
      '[ "$(runtime_sha256 "$RELEASE_DIR")" = "$(cat "$RELEASE_DIR/.runtime.sha256")" ]',
    );
    expect(script).toContain('Refusing release: immutable release directory is invalid');
    expect(script).not.toContain('RELEASE_DIR}.invalid');
    expect(script).toContain('curl -fsS --connect-timeout 2 --max-time 5');
    expect(script).toContain('CONTEXGIN_PROBE_ROOT');
    expect(script).toContain('mkdir -p "$(dirname "$SERVE_DB_PATH")"');
    expect(script).toContain('CONTEXGIN_DB_PATH must be absolute or :memory:');
    expect(script).toContain(
      'wait_for_deployment_health "$PREVIOUS_PORT" "$PREVIOUS_COMMIT" "$PREVIOUS_WORKING_DIRECTORY"',
    );
    expect(script).toContain('launchctl print "$DOMAIN/$LABEL"');
    expect(script).toContain('working directory = $expected_working_directory');
    expect(script).toContain('ROLLBACK FAILED: previous ContexGin plist could not be bootstrapped');
    expect(script).toContain(
      'ROLLBACK FAILED: previous ContexGin deployment did not become healthy',
    );
    expect(script).not.toContain('bootout_and_wait || true');
    expect(script).not.toContain('bootstrap_with_retry || true');
    expect(script).not.toContain('/Users/dsaridak');
    expect(readFileSync(join(repoRoot, 'scripts/start.sh'), 'utf8')).not.toContain(
      '/Users/dsaridak',
    );
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

  it('renders launchd paths with plist-aware escaping', () => {
    const root = mkdtempSync(join(tmpdir(), 'contexgin-plist-'));
    const rendered = join(root, 'rendered.plist');
    const release = join(root, 'release & | path');
    execFileSync('python3', [
      join(repoRoot, 'scripts/render-launchd-plist.py'),
      join(repoRoot, 'infra/com.contexgin.server.plist'),
      rendered,
      release,
      'a'.repeat(40),
      '/workspace/one:/workspace/two & three',
      '/state/graph & data.db',
      '4195',
    ]);

    const xml = readFileSync(rendered, 'utf8');
    expect(xml).toContain('release &amp; | path');
    expect(xml).toContain('a'.repeat(40));
    expect(xml).toContain('/workspace/one:/workspace/two &amp; three');
    expect(xml).toContain('/state/graph &amp; data.db');
  });

  it('rejects staged source drift and modified generated artifacts or dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'contexgin-start-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, 'node_modules/example'), { recursive: true });
    cpSync(join(repoRoot, 'scripts/start.sh'), join(root, 'scripts/start.sh'));
    cpSync(join(repoRoot, 'scripts/runtime-sha256.sh'), join(root, 'scripts/runtime-sha256.sh'));
    writeFileSync(join(root, 'tracked.txt'), 'clean\n');
    writeFileSync(join(root, 'dist/cli.js'), 'clean\n');
    writeFileSync(join(root, 'node_modules/example/index.js'), 'dependency\n');
    writeFileSync(join(root, '.gitignore'), 'dist/\nnode_modules/\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: root });
    execFileSync('git', ['checkout', '--detach'], { cwd: root });
    const digest = execFileSync(join(root, 'scripts/runtime-sha256.sh'), [root], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    writeFileSync(join(root, '.runtime.sha256'), `${digest}\n`);
    execFileSync('git', ['add', '.runtime.sha256'], { cwd: root });
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
    expect(result.stderr).toContain('runtime inputs do not match');

    writeFileSync(join(root, 'dist/cli.js'), 'clean\n');
    writeFileSync(join(root, 'node_modules/example/index.js'), 'tampered dependency\n');
    result = spawnSync('bash', [join(root, 'scripts/start.sh')], {
      env: { ...process.env, CONTEXGIN_DEPLOYMENT_COMMIT: pinned },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('runtime inputs do not match');
  });
});
