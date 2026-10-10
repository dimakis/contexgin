import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../scripts/runtime-sha256.sh');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'contexgin-runtime-'));
  mkdirSync(join(root, 'dist'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'dist/cli.js'), 'runtime');
  return root;
}
const fingerprint = (root: string) => execFileSync(script, [root], { encoding: 'utf8' }).trim();
describe('runtime closure fingerprint', () => {
  it('detects payload, path and executable-mode changes', () => {
    const root = fixture();
    const original = fingerprint(root);
    chmodSync(join(root, 'dist/cli.js'), 0o755);
    expect(fingerprint(root)).not.toBe(original);
    const executable = fingerprint(root);
    renameSync(join(root, 'dist/cli.js'), join(root, 'dist/renamed.js'));
    expect(fingerprint(root)).not.toBe(executable);
  });
  it('allows contained npm links and rejects targets outside the runtime closure', () => {
    const root = fixture();
    mkdirSync(join(root, 'node_modules/.bin'));
    writeFileSync(join(root, 'node_modules/example.js'), 'package');
    symlinkSync('../example.js', join(root, 'node_modules/.bin/example'));
    expect(fingerprint(root)).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(root, 'outside.js'), 'external');
    symlinkSync('../outside.js', join(root, 'dist/external.js'));
    const result = spawnSync(script, [root], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('outside runtime closure');
  });
});
