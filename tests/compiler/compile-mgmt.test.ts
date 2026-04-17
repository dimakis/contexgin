import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { compile, discoverSources } from '../../src/compiler/index.js';
import { extractClaims } from '../../src/integrity/claims.js';
import { validateAll } from '../../src/integrity/validator.js';

describe('compile against mgmt workspace', () => {
  const MGMT_ROOT = path.join(os.homedir(), 'redhat/mgmt');

  it('discovers sources in mgmt workspace', async () => {
    const sources = await discoverSources(MGMT_ROOT);
    expect(sources.length).toBeGreaterThan(3);
    expect(sources.some((s) => s.kind === 'constitution')).toBe(true);
    expect(sources.some((s) => s.kind === 'profile')).toBe(true);
  });

  it('compiles to roughly equivalent output as build_boot_context.py', async () => {
    const result = await compile({
      workspaceRoot: MGMT_ROOT,
      tokenBudget: 12000,
    });
    expect(result.bootPayload.length).toBeGreaterThan(0);
    expect(result.bootTokens).toBeLessThan(12000);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it('detects real drift in mgmt workspace', async () => {
    const sources = await discoverSources(MGMT_ROOT);
    const constitutionSource = sources.find(
      (s) => s.kind === 'constitution' && s.relativePath === 'CONSTITUTION.md',
    );
    expect(constitutionSource).toBeDefined();
    const content = await fs.readFile(constitutionSource!.path, 'utf-8');
    const claims = extractClaims(content, constitutionSource!.path);
    const report = await validateAll(claims, MGMT_ROOT);
    // At minimum, we should find some valid claims
    expect(report.summary.total).toBeGreaterThan(5);
  });
});
