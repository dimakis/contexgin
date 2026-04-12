import type { DeclaredNode } from './tree-parser.js';
import type { ActualNode } from './tree-walker.js';

/** Result of diffing a declared tree against an actual filesystem tree */
export interface TreeDiffResult {
  /** Paths declared in constitution but missing on disk */
  declaredButMissing: DeclaredNode[];
  /** Paths present on disk but not declared in constitution */
  presentButUndeclared: ActualNode[];
  /** Paths that match between declared and actual */
  matched: DeclaredNode[];
}

/**
 * Diff a declared tree against an actual filesystem tree.
 * Matching is by normalized relative path.
 */
export function diffTrees(declared: DeclaredNode[], actual: ActualNode[]): TreeDiffResult {
  // Index actual nodes by normalized path for type-aware matching
  const actualByPath = new Map(actual.map((n) => [normalizePath(n.path), n]));
  const declaredPaths = new Set(declared.map((n) => normalizePath(n.path)));

  const matched: DeclaredNode[] = [];
  const declaredButMissing: DeclaredNode[] = [];

  for (const node of declared) {
    const normalized = normalizePath(node.path);
    const actualNode = actualByPath.get(normalized);
    if (actualNode && actualNode.type === node.type) {
      matched.push(node);
    } else {
      declaredButMissing.push(node);
    }
  }

  const presentButUndeclared: ActualNode[] = [];
  for (const node of actual) {
    if (!declaredPaths.has(normalizePath(node.path))) {
      presentButUndeclared.push(node);
    }
  }

  return { declaredButMissing, presentButUndeclared, matched };
}

/** Normalize path for comparison: strip leading ./ */
function normalizePath(p: string): string {
  return p.replace(/^\.\//, '');
}
