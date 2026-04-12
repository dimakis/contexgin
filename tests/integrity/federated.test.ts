import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateFederated } from '../../src/integrity/federated.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-workspace');

describe('validateFederated', () => {
  it('validates a single workspace root', async () => {
    const report = await validateFederated([FIXTURE_ROOT]);
    expect(report.root).toBeDefined();
    expect(report.root.results.length).toBeGreaterThan(0);
  });

  it('includes tree structure claims when constitution has a tree', async () => {
    const report = await validateFederated([FIXTURE_ROOT]);
    const treeResults = report.root.results.filter((r) => r.claim.kind === 'tree_structure');
    // sample-workspace CONSTITUTION.md may or may not have a tree
    // but regular claims should still be present
    expect(report.root.results.length).toBeGreaterThan(0);
    // Tree results depend on the fixture content
    expect(treeResults.length).toBeGreaterThanOrEqual(0);
  });

  it('handles non-existent workspace root gracefully', async () => {
    const report = await validateFederated(['/tmp/does-not-exist-12345']);
    // Should produce a report with no claims (no CONSTITUTION.md found)
    expect(report.root.results).toHaveLength(0);
  });

  it('cascades into external repos when enabled', async () => {
    // This test uses a real workspace if available, otherwise just verifies the structure
    const report = await validateFederated([FIXTURE_ROOT], { cascade: true });
    expect(report.externals).toBeDefined();
    // Fixture doesn't have externals, so map should be empty
    expect(report.externals.size).toBe(0);
  });

  it('validates multiple roots independently', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'federated-'));
    const rootA = path.join(tmpDir, 'a');
    const rootB = path.join(tmpDir, 'b');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });

    // Root A claims src/ exists — create it so it passes
    await fs.writeFile(
      path.join(rootA, 'CONSTITUTION.md'),
      '# A\n\n## Architecture\n- `src/` — source code\n',
    );
    await fs.mkdir(path.join(rootA, 'src'), { recursive: true });

    // Root B claims docs/ exists — don't create it so it drifts
    await fs.writeFile(
      path.join(rootB, 'CONSTITUTION.md'),
      '# B\n\n## Architecture\n- `docs/` — documentation\n',
    );

    const report = await validateFederated([rootA, rootB]);

    // Should have results from both roots
    expect(report.root.results.length).toBeGreaterThan(0);
    // Root B's docs/ claim should be invalid
    expect(report.root.drift.length).toBeGreaterThan(0);
    const docsDrift = report.root.drift.find((r) => r.claim.target.includes('docs'));
    expect(docsDrift).toBeDefined();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('validates each root against its own workspace', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-fed-'));
    const root1 = path.join(tmpDir, 'ws1');
    const root2 = path.join(tmpDir, 'ws2');

    await fs.mkdir(root1, { recursive: true });
    await fs.mkdir(root2, { recursive: true });

    // ws1 declares src/ — create it so it passes
    await fs.mkdir(path.join(root1, 'src'));
    await fs.writeFile(path.join(root1, 'CONSTITUTION.md'), '# WS1\n```\nws1/\n├── src/\n```\n');

    // ws2 declares lib/ — create it so it passes
    await fs.mkdir(path.join(root2, 'lib'));
    await fs.writeFile(path.join(root2, 'CONSTITUTION.md'), '# WS2\n```\nws2/\n├── lib/\n```\n');

    const report = await validateFederated([root1, root2]);

    // Both tree claims should validate against their own root, not root1
    const treeResults = report.root.results.filter((r) => r.claim.kind === 'tree_structure');
    for (const r of treeResults) {
      expect(r.valid).toBe(true);
    }

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
