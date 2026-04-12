import { describe, it, expect } from 'vitest';
import { diffTrees } from '../../src/integrity/tree-diff.js';
import type { DeclaredNode } from '../../src/integrity/tree-parser.js';
import type { ActualNode } from '../../src/integrity/tree-walker.js';

function declaredDir(path: string): DeclaredNode {
  return { path, name: path.replace(/\/$/, ''), type: 'directory', source: 'tree' };
}

function actualDir(path: string): ActualNode {
  return { path, name: path.replace(/\/$/, ''), type: 'directory' };
}

function actualFile(path: string): ActualNode {
  return { path, name: path.split('/').pop()!, type: 'file' };
}

describe('diffTrees', () => {
  it('reports all matched when declared and actual are identical', () => {
    const declared: DeclaredNode[] = [declaredDir('src/'), declaredDir('tests/')];
    const actual: ActualNode[] = [actualDir('src/'), actualDir('tests/')];

    const result = diffTrees(declared, actual);
    expect(result.matched).toHaveLength(2);
    expect(result.declaredButMissing).toHaveLength(0);
    expect(result.presentButUndeclared).toHaveLength(0);
  });

  it('flags declared paths missing from disk', () => {
    const declared: DeclaredNode[] = [declaredDir('src/'), declaredDir('docs/')];
    const actual: ActualNode[] = [actualDir('src/')];

    const result = diffTrees(declared, actual);
    expect(result.declaredButMissing).toHaveLength(1);
    expect(result.declaredButMissing[0].path).toBe('docs/');
    expect(result.matched).toHaveLength(1);
  });

  it('flags actual paths not declared', () => {
    const declared: DeclaredNode[] = [declaredDir('src/')];
    const actual: ActualNode[] = [actualDir('src/'), actualFile('.eslintrc'), actualDir('dist/')];

    const result = diffTrees(declared, actual);
    expect(result.presentButUndeclared).toHaveLength(2);
    expect(result.presentButUndeclared.map((n) => n.path).sort()).toEqual(['.eslintrc', 'dist/']);
  });

  it('handles mixed scenario', () => {
    const declared: DeclaredNode[] = [
      declaredDir('src/'),
      declaredDir('docs/'),
      declaredDir('memory/'),
    ];
    const actual: ActualNode[] = [actualDir('src/'), actualDir('memory/'), actualFile('README.md')];

    const result = diffTrees(declared, actual);
    expect(result.matched).toHaveLength(2);
    expect(result.declaredButMissing).toHaveLength(1);
    expect(result.declaredButMissing[0].path).toBe('docs/');
    expect(result.presentButUndeclared).toHaveLength(1);
    expect(result.presentButUndeclared[0].path).toBe('README.md');
  });

  it('normalizes paths for comparison', () => {
    const declared: DeclaredNode[] = [declaredDir('./src/')];
    const actual: ActualNode[] = [actualDir('src/')];

    const result = diffTrees(declared, actual);
    expect(result.matched).toHaveLength(1);
    expect(result.declaredButMissing).toHaveLength(0);
  });

  it('flags type mismatch — declared directory exists as file', () => {
    const declared: DeclaredNode[] = [declaredDir('src/')];
    const actual: ActualNode[] = [actualFile('src/')];

    const result = diffTrees(declared, actual);
    expect(result.matched).toHaveLength(0);
    expect(result.declaredButMissing).toHaveLength(1);
    expect(result.declaredButMissing[0].path).toBe('src/');
  });
});
