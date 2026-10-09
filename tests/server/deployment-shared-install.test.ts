import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('refuses shared release installation while another service owns its install lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-shared-install-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'shlock'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'shlock'), 0o755);
  const controller = readFileSync(
    resolve(import.meta.dirname, '../../scripts/create-release.sh'),
    'utf8',
  );
  const start = controller.indexOf('release_is_valid() {');
  const end = controller.indexOf('\nRELEASE_TEMP=""', start);
  for (const service of ['server', 'publisher']) {
    const temp = join(root, service);
    mkdirSync(join(temp, 'release'), { recursive: true });
    writeFileSync(join(temp, 'release', 'sentinel'), service);
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -euo pipefail
RELEASE_ROOT="$FIXTURE_ROOT"
RELEASE_DIR="$FIXTURE_ROOT/shared-release"
RELEASE_TEMP="$FIXTURE_TEMP"
RELEASE_INSTALL_LOCK="$FIXTURE_ROOT/.release-install.lock"
RELEASE_INSTALL_LOCK_HELD=0
${controller.slice(start, end)}`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_ROOT: root,
          FIXTURE_TEMP: temp,
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('shared release installation is active');
    expect(existsSync(join(root, 'shared-release'))).toBe(false);
    expect(readFileSync(join(temp, 'release', 'sentinel'), 'utf8')).toBe(service);
  }
});
