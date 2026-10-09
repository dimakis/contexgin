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

it('refuses cutover when main advances during original-owner verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-fresh-main-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nprintf "new-main\\trefs/heads/main\\n"\n');
  chmodSync(join(bin, 'git'), 0o755);
  const controller = readFileSync(
    resolve(import.meta.dirname, '../../scripts/create-release.sh'),
    'utf8',
  );
  const start = controller.lastIndexOf('\nif [ -n "$PLIST_PREVIOUS" ]; then');
  const end = controller.indexOf('\nmv "$PLIST_NEXT" "$PLIST_DEST"', start);
  const cutover = join(root, 'controlled');
  const result = spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
PLIST_PREVIOUS=fixture
PREVIOUS_PORT=4195
PREVIOUS_COMMIT=old
PREVIOUS_WORKING_DIRECTORY=/fixture
PREVIOUS_ALLOW_LEGACY_DIRECTORY=0
PREVIOUS_PROGRAM=fixture
SOURCE_ROOT=/fixture
SOURCE_COMMIT=old-main
wait_for_deployment_health() { return 0; }
bootout_and_wait() { touch "$FIXTURE_CUTOVER"; return 0; }
${controller.slice(start, end)}`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_CUTOVER: cutover },
    },
  );
  expect(result.status).not.toBe(0);
  expect(existsSync(cutover)).toBe(false);
  expect(result.stderr).toContain('accepted main advanced');
});
