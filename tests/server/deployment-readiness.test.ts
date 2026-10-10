import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../..');

function probe(
  status: string,
  revision: string,
  expected = 'expected',
  options: { legacy?: boolean; cwd?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-readiness-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const programs = {
    launchctl: options.legacy
      ? '#!/bin/sh\nprintf "job = {\\n state = running\\n program = /legacy/start.sh\\n path = /fixture.plist\\n pid = 123\\n}\\n"\n'
      : '#!/bin/sh\nprintf "job = {\\n state = running\\n working directory = /release\\n pid = 123\\n}\\n"\n',
    lsof: `#!/bin/sh\ncase "$*" in *'-d cwd'*) printf 'p123\\nfcwd\\nn${options.cwd ?? '/release'}\\n' ;; *) printf '123\\n' ;; esac\n`,
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
      `set -euo pipefail\nDOMAIN=fixture\nLABEL=fixture\nPLIST_DEST=/fixture.plist\nSTARTUP_TIMEOUT_SECONDS=1\n${functionBody}\nwait_for_deployment_health 4195 '${expected}' /release ${options.legacy ? '1' : '0'} /legacy/start.sh`,
    ],
    {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 5000,
    },
  );
}

describe('deployment readiness', () => {
  it('verifies legacy jobs through the original launcher and actual process directory', () => {
    expect(probe('ok', '', '', { legacy: true }).status).toBe(0);
    expect(probe('ok', '', '', { legacy: true, cwd: '/unrelated' }).status).not.toBe(0);
  });
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
