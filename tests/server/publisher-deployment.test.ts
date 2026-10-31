import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../..');
const fixture = () => mkdtempSync(join(tmpdir(), 'contexgin-publisher-deployment-'));

describe('publisher deployment', () => {
  it('does not source an external shell startup file before rejecting its setting', () => {
    const root = fixture();
    const marker = join(root, 'external-code-ran');
    const startup = join(root, 'startup.sh');
    writeFileSync(startup, 'touch "$FIXTURE_MARKER"\n');
    for (const script of ['start.sh', 'create-release.sh']) {
      const result = spawnSync(join(repo, 'scripts', script), [], {
        encoding: 'utf8',
        env: { ...process.env, BASH_ENV: startup, FIXTURE_MARKER: marker, CONTEXGIN_ROOTS: '.' },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('external runtime loading');
      expect(existsSync(marker)).toBe(false);
    }
  });
  it('passes an explicitly selected durable goals store to the workspace server', () => {
    const root = fixture();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(join(bin, 'node'), 0o755);
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
        CONTEXGIN_SERVICE: 'server',
        CONTEXGIN_ROOTS: root,
        CONTEXGIN_DB_PATH: join(root, 'graph.db'),
        CONTEXGIN_GOALS_DB_PATH: join(root, 'goals.db'),
        CONTEXGIN_PORT: '4195',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'dist/cli.js',
      'serve',
      realpathSync(root),
      '--db',
      join(root, 'graph.db'),
      '--port',
      '4195',
      '--goals-db',
      join(root, 'goals.db'),
    ]);
  });
  it.each(['NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV', 'PYTHONPATH'])(
    'refuses inherited external loader settings: %s',
    (setting) => {
      const root = fixture();
      const previous = join(root, 'previous.plist');
      execFileSync('python3', [
        '-c',
        "import plistlib,sys;plistlib.dump({'Label':'com.contexgin.publisher','EnvironmentVariables':{sys.argv[2]:'/outside/runtime'}},open(sys.argv[1],'wb'))",
        previous,
        setting,
      ]);
      const rendered = spawnSync(
        'python3',
        [
          join(repo, 'scripts/render-launchd-plist.py'),
          join(repo, 'infra/com.contexgin.server.plist'),
          join(root, 'next.plist'),
          root,
          'a'.repeat(40),
          '',
          '/state/graph.db',
          '8643',
          'b'.repeat(64),
          'publisher',
          previous,
          '/state/publication.json',
          '/state/goals.db',
        ],
        { encoding: 'utf8' },
      );
      expect(rendered.status).not.toBe(0);
      expect(rendered.stderr).toContain('external runtime loading');
      // macOS strips DYLD variables before protected /bin/bash executes.
      // The renderer and audit still reject them in a stored launchd plist.
      if (setting.startsWith('DYLD_') && process.platform === 'darwin') return;
      const started = spawnSync('bash', [join(repo, 'scripts/start.sh')], {
        encoding: 'utf8',
        env: { ...process.env, [setting]: '/outside/runtime', CONTEXGIN_ROOTS: '.' },
      });
      expect(started.status).not.toBe(0);
      expect(started.stderr).toContain('external runtime loading');
      const planned = spawnSync('bash', [join(repo, 'scripts/create-release.sh')], {
        encoding: 'utf8',
        env: { ...process.env, [setting]: '/outside/runtime', CONTEXGIN_ROOTS: '.' },
      });
      expect(planned.status).not.toBe(0);
      expect(planned.stderr).toContain('external runtime loading');
    },
  );
  it('bounds both build commands without retaining loader settings in the controller', () => {
    const root = fixture();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf "%s|%s\\n" "$*" "$NODE_OPTIONS"\n');
    chmodSync(join(bin, 'npm'), 0o755);
    const controller = readFileSync(join(repo, 'scripts/create-release.sh'), 'utf8');
    const start = controller.indexOf('BUILD_HEAP_MB=');
    const build = controller.slice(start, controller.indexOf('\nSOURCE_ROOT=', start));
    const invoke = (heap?: string) =>
      spawnSync(
        'bash',
        [
          '-c',
          `set -euo pipefail\n${build}\nbuild_release\nprintf 'parent:%s' "\${NODE_OPTIONS-unset}"`,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            CONTEXGIN_BUILD_HEAP_MB: heap,
          },
        },
      );
    for (const heap of [undefined, '1024', '2048', '4096', '8192']) {
      const result = invoke(heap);
      expect(result.status).toBe(0);
      expect(result.stdout.split('\n')).toEqual([
        `--node-options=--max-old-space-size=${heap ?? 1024} ci|--max-old-space-size=${heap ?? 1024}`,
        `--node-options=--max-old-space-size=${heap ?? 1024} run build|--max-old-space-size=${heap ?? 1024}`,
        'parent:unset',
      ]);
    }
    for (const heap of ['0', '999999', '1024 --require /outside/runtime', '$(touch outside)']) {
      const result = invoke(heap);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('CONTEXGIN_BUILD_HEAP_MB must be');
    }
    // Exercise npm's real lifecycle configuration boundary without installing
    // dependencies or building: CLI config must override even a local .npmrc.
    writeFileSync(join(root, '.npmrc'), 'node-options=--require /outside/runtime\n');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { budget: 'node -p "process.env.NODE_OPTIONS"' } }),
    );
    const lifecycle = spawnSync(
      'npm',
      ['--node-options=--max-old-space-size=1024', 'run', '--silent', 'budget'],
      { cwd: root, encoding: 'utf8', env: process.env },
    );
    expect(lifecycle.status).toBe(0);
    expect(lifecycle.stdout.trim()).toBe('--max-old-space-size=1024');
    for (const setting of [
      'npm_config_node_options',
      'NPM_CONFIG_NODE_OPTIONS',
      'Npm_Config_Node_Options',
    ]) {
      const result = spawnSync('bash', [join(repo, 'scripts/create-release.sh')], {
        encoding: 'utf8',
        env: { ...process.env, [setting]: '--require /outside/runtime' },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('external runtime loading');
    }
  });
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
      'https://example.invalid/accepted.git',
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
      CONTEXGIN_DEPLOYMENT_ORIGIN: 'https://example.invalid/accepted.git',
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
