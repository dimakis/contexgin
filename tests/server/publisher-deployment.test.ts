import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../..');
const fixture = () => mkdtempSync(join(tmpdir(), 'contexgin-publisher-deployment-'));

describe('publisher deployment', () => {
  it('refuses publisher plans without explicitly selected graph and goals databases', () => {
    const root = fixture();
    const config = join(root, 'publication.json');
    writeFileSync(config, '{}');
    for (const missing of ['CONTEXGIN_DB_PATH', 'CONTEXGIN_GOALS_DB_PATH']) {
      const env = {
        ...process.env,
        HOME: root,
        CONTEXGIN_SERVICE: 'publisher',
        CONTEXGIN_PUBLICATION_CONFIG: config,
        CONTEXGIN_DB_PATH: join(root, 'graph.db'),
        CONTEXGIN_GOALS_DB_PATH: join(root, 'goals.db'),
      };
      delete env[missing as keyof typeof env];
      const result = spawnSync(
        'bash',
        [join(repo, 'scripts/create-release.sh'), 'HEAD', '--plan'],
        { encoding: 'utf8', env },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'publisher requires explicit absolute graph and goals database paths',
      );
    }
  });
  it('preserves private credentials and standalone settings when rendering its guarded launcher', () => {
    const root = fixture();
    const previous = join(root, 'previous.plist');
    const rendered = join(root, 'rendered.plist');
    execFileSync('python3', [
      '-c',
      `import plistlib,sys
plistlib.dump({'Label':'com.contexgin.publisher','EnvironmentVariables':{'FIXTURE_SECRET':'fixture-only','CONTEXGIN_DEPLOYMENT_COMMIT':'old'}},open(sys.argv[1],'wb'))`,
      previous,
    ]);
    execFileSync('python3', [
      join(repo, 'scripts/render-launchd-plist.py'),
      join(repo, 'infra/com.contexgin.server.plist'),
      rendered,
      root,
      'a'.repeat(40),
      '',
      '/private/graph.db',
      '8643',
      'b'.repeat(64),
      'publisher',
      previous,
      '/private/publication.json',
      '/private/goals.db',
    ]);
    const result = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))',
          rendered,
        ],
        { encoding: 'utf8' },
      ),
    );
    expect(result.Label).toBe('com.contexgin.publisher');
    expect(result.ProgramArguments).toEqual([join(root, 'scripts/start.sh')]);
    expect(result.EnvironmentVariables).toMatchObject({
      FIXTURE_SECRET: 'fixture-only',
      CONTEXGIN_DEPLOYMENT_COMMIT: 'a'.repeat(40),
      CONTEXGIN_SERVICE: 'publisher',
      CONTEXGIN_ROOTS: '',
      CONTEXGIN_PORT: '8643',
      CONTEXGIN_PUBLICATION_CONFIG: '/private/publication.json',
      CONTEXGIN_GOALS_DB_PATH: '/private/goals.db',
    });
    expect(readFileSync(rendered, 'utf8')).not.toContain('<string>old</string>');
  });

  it('starts a standalone publisher with its publication and goals paths and no workspace roots', () => {
    const root = fixture();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(join(bin, 'node'), 0o755);
    const config = join(root, 'publication.json');
    writeFileSync(config, '{}');
    const script = readFileSync(join(repo, 'scripts/start.sh'), 'utf8').replace(
      'export PATH="/opt/homebrew/bin:$PATH"',
      'export PATH="$FIXTURE_BIN:$PATH"',
    );
    const launcher = join(root, 'start.sh');
    writeFileSync(launcher, script);
    const result = spawnSync('bash', [launcher], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FIXTURE_BIN: bin,
        CONTEXGIN_SERVICE: 'publisher',
        CONTEXGIN_PUBLICATION_CONFIG: config,
        CONTEXGIN_DB_PATH: join(root, 'graph.db'),
        CONTEXGIN_GOALS_DB_PATH: join(root, 'goals.db'),
        CONTEXGIN_PORT: '8643',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'dist/cli.js',
      'serve',
      '--db',
      join(root, 'graph.db'),
      '--port',
      '8643',
      '--no-watch',
      '--publication-config',
      config,
      '--goals-db',
      join(root, 'goals.db'),
    ]);
  });

  it('refuses missing publisher configuration before launching the app', () => {
    const result = spawnSync('bash', [join(repo, 'scripts/start.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CONTEXGIN_SERVICE: 'publisher',
        CONTEXGIN_PUBLICATION_CONFIG: '/nonexistent/publication.json',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'publisher requires an existing absolute publication configuration',
    );
  });

  it('refuses production feature revisions before building or controlling launchd', () => {
    const root = fixture();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'shlock'), '#!/bin/sh\nexit 0\n');
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh
case "$*" in
  *'fetch '*) exit 0 ;;
  *'origin/main'*) printf '%040d\\n' 2 ;;
  *'rev-parse --verify'*) printf '%040d\\n' 1 ;;
  *) echo 'unexpected git command' >&2; exit 99 ;;
esac
`,
    );
    for (const name of ['shlock', 'git']) chmodSync(join(bin, name), 0o755);
    const result = spawnSync('bash', [join(repo, 'scripts/create-release.sh'), 'HEAD'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: root,
        PATH: `${bin}:${process.env.PATH}`,
        CONTEXGIN_ROOTS: root,
        CONTEXGIN_RELEASE_ROOT: join(root, 'releases'),
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('production requires exact accepted main');
  });
});
