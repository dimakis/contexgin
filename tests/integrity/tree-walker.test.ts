import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { walkFilesystem } from '../../src/integrity/tree-walker.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-workspace');

describe('walkFilesystem', () => {
  it('walks fixture directory and returns entries', async () => {
    const nodes = await walkFilesystem(FIXTURE_ROOT);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some((n) => n.path === 'src/' && n.type === 'directory')).toBe(true);
    expect(nodes.some((n) => n.path === 'CONSTITUTION.md' && n.type === 'file')).toBe(true);
  });

  it('returns correct types for files and directories', async () => {
    const nodes = await walkFilesystem(FIXTURE_ROOT);
    const srcDir = nodes.find((n) => n.path === 'src/');
    expect(srcDir?.type).toBe('directory');

    const indexFile = nodes.find((n) => n.path === 'src/index.ts');
    expect(indexFile?.type).toBe('file');
  });

  it('respects maxDepth limit', async () => {
    const depth1 = await walkFilesystem(FIXTURE_ROOT, { maxDepth: 1 });
    // At depth 1, should see src/ but not src/compiler/
    expect(depth1.some((n) => n.path === 'src/')).toBe(true);
    expect(depth1.some((n) => n.path === 'src/compiler/')).toBe(false);

    const depth2 = await walkFilesystem(FIXTURE_ROOT, { maxDepth: 2 });
    // At depth 2, should see src/compiler/
    expect(depth2.some((n) => n.path === 'src/compiler/')).toBe(true);
  });

  it('ignores default excluded patterns', async () => {
    const nodes = await walkFilesystem(FIXTURE_ROOT);
    expect(nodes.some((n) => n.name === '.git')).toBe(false);
    expect(nodes.some((n) => n.name === 'node_modules')).toBe(false);
    expect(nodes.some((n) => n.name === '.DS_Store')).toBe(false);
  });

  it('supports custom ignore patterns', async () => {
    const nodes = await walkFilesystem(FIXTURE_ROOT, {
      ignorePatterns: ['src'],
    });
    expect(nodes.some((n) => n.path === 'src/')).toBe(false);
  });
});
