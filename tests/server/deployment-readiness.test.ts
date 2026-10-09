import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../..');

function probe(status: string, revision: string, expected = 'expected') {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-readiness-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const programs = {
    launchctl:
      '#!/bin/sh\nprintf "job = {\\n state = running\\n working directory = /release\\n pid = 123\\n}\\n"\n',
    lsof: '#!/bin/sh\nprintf "123\\n"\n',
    curl: `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ status, deploymentCommit: revision })}'\n`,
  };
  for (const [name, contents] of Object.entries(programs)) {
    writeFileSync(join(bin, name), contents);
    chmodSync(join(bin, name), 0o755);
  }
  const controller = readFileSync(join(repo, 'scripts/create-release.sh'), 'utf8');
  const functionBody = controller.slice(
    controller.indexOf('wait_for_deployment_health()'),
    controller.indexOf('\nrollback()'),
  );
  return spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail\nDOMAIN=fixture\nLABEL=fixture\nSTARTUP_TIMEOUT_SECONDS=1\n${functionBody}\nwait_for_deployment_health 4195 '${expected}' /release`,
    ],
    {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 5000,
    },
  );
}

describe('deployment readiness', () => {
  it('accepts the original job and listener only after healthy commit attestation', () => {
    expect(probe('ok', 'expected').status).toBe(0);
  });
  it('refuses rebuilding or wrong-commit responders', () => {
    expect(probe('building', 'expected').status).not.toBe(0);
    expect(probe('ok', 'other').status).not.toBe(0);
  });
  it('requires healthy status from legacy responders without commit metadata', () => {
    expect(probe('ok', '', '').status).toBe(0);
    expect(probe('building', '', '').status).not.toBe(0);
  });
});
