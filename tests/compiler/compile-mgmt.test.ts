import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { compile } from '../../src/compiler/index.js';
import { discoverAndAdapt } from '../../src/adapter/index.js';
import { extractClaims } from '../../src/integrity/claims.js';
import { validateAll } from '../../src/integrity/validator.js';

// Skip these tests in CI — they require the mgmt workspace which is not available
const describeLocal = process.env.CI ? describe.skip : describe;

describeLocal('compile against mgmt workspace', () => {
  const MGMT_ROOT = path.join(os.homedir(), 'redhat/mgmt');

  it('discovers sources in mgmt workspace', async () => {
    const nodes = await discoverAndAdapt(MGMT_ROOT);
    expect(nodes.length).toBeGreaterThan(3);
    expect(nodes.some((n) => n.origin.format === 'constitution')).toBe(true);
    expect(
      nodes.some(
        (n) =>
          n.origin.relativePath.startsWith('memory/Profile/') ||
          n.origin.relativePath.startsWith('memory\\Profile\\'),
      ),
    ).toBe(true);
  });

  it('compiles mgmt workspace with typed nodes', async () => {
    const result = await compile({
      workspaceRoot: MGMT_ROOT,
      tokenBudget: 12000,
    });
    expect(result.bootPayload.length).toBeGreaterThan(0);
    expect(result.bootTokens).toBeLessThan(12000);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.nodes).toBeDefined();
    expect(result.nodes!.length).toBeGreaterThan(0);
  });

  it('detects real drift in mgmt workspace', async () => {
    const nodes = await discoverAndAdapt(MGMT_ROOT);
    const constitutionNode = nodes.find(
      (n) => n.origin.format === 'constitution' && n.origin.relativePath === 'CONSTITUTION.md',
    );
    expect(constitutionNode).toBeDefined();
    const content = await fs.readFile(constitutionNode!.origin.source, 'utf-8');
    const claims = extractClaims(content, constitutionNode!.origin.source);
    const report = await validateAll(claims, MGMT_ROOT);
    // At minimum, we should find some valid claims
    expect(report.summary.total).toBeGreaterThan(5);
  });
});
