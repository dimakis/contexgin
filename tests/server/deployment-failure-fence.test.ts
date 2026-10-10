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

it('persists a failed rollback fence independently of the exited lock owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-failed-rollback-'));
  const lock = join(root, 'lock');
  const failure = lock + '.failed';
  writeFileSync(lock, '99999999\n');
  const controller = readFileSync(
    resolve(import.meta.dirname, '../../scripts/create-release.sh'),
    'utf8',
  );
  const cleanup = controller.slice(
    controller.indexOf('cleanup()'),
    controller.indexOf('\ntrap cleanup EXIT'),
  );
  const result = spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
LOCK_FILE="$FIXTURE_LOCK"
FAILURE_MARKER="$LOCK_FILE.failed"
CUTOVER_ACTIVE=1
PLIST_DEST=/fixture.plist
PLIST_NEXT=""
RELEASE_TEMP=""
LABEL=fixture
SOURCE_COMMIT=fixture
rollback() { return 1; }
${cleanup}
cleanup`,
    ],
    { encoding: 'utf8', env: { ...process.env, FIXTURE_LOCK: lock } },
  );
  expect(result.status).toBe(1);
  expect(existsSync(failure)).toBe(true);
  const originalMarker = readFileSync(failure, 'utf8');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries({
    shlock: 'exit 0',
    git: 'echo unexpected-git >&2; exit 99',
  })) {
    writeFileSync(join(bin, name), '#!/bin/sh\n' + body + '\n');
    chmodSync(join(bin, name), 0o755);
  }
  const script = join(root, 'controller.sh');
  writeFileSync(
    script,
    controller.replace('LOCK_FILE="/tmp/$LABEL.$(id -u).deploy.lock"', 'LOCK_FILE="$FIXTURE_LOCK"'),
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = spawnSync('bash', [script, 'HEAD', '--plan'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: root,
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_LOCK: lock,
        CONTEXGIN_ROOTS: root,
        CONTEXGIN_RELEASE_ROOT: join(root, 'releases'),
      },
    });
    expect(retry.status).not.toBe(0);
    expect(retry.stderr).toContain('failed rollback requires investigation');
    expect(readFileSync(failure, 'utf8')).toBe(originalMarker);
  }
});

it('fails rollback before bootstrapping if the previous plist cannot be restored', () => {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-rollback-move-'));
  const marker = join(root, 'bootstrapped');
  const script = readFileSync(
    resolve(import.meta.dirname, '../../scripts/create-release.sh'),
    'utf8',
  );
  const rollback = script.slice(
    script.indexOf('\nrollback() {') + 1,
    script.indexOf('\ncleanup()'),
  );
  const previous = join(root, 'previous.plist');
  writeFileSync(previous, 'saved');
  const result = spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
PLIST_PREVIOUS="$FIXTURE_PREVIOUS"
PLIST_DEST=/fixture/replacement
PREVIOUS_PORT=4195
PREVIOUS_COMMIT=fixture
PREVIOUS_WORKING_DIRECTORY=/fixture
bootout_and_wait() { return 0; }
bootstrap_with_retry() { touch "$FIXTURE_MARKER";return 0; }
wait_for_deployment_health() { return 0; }
mv() { return 1; }
${rollback}
if ! rollback; then [ "$PLIST_PREVIOUS" = "$FIXTURE_PREVIOUS" ];else exit 9;fi`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, FIXTURE_PREVIOUS: previous, FIXTURE_MARKER: marker },
    },
  );
  expect(result.status).toBe(0);
  expect(existsSync(marker)).toBe(false);
  expect(result.stderr).toContain('previous ContexGin plist could not be restored');
  expect(readFileSync(previous, 'utf8')).toBe('saved');
});
