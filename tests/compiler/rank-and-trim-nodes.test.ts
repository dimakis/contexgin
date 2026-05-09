import { describe, it, expect } from 'vitest';
import { rankNodes, trimNodesToBudget } from '../../src/compiler/index.js';
import type { ContextNode, RankedNode } from '../../src/adapter/types.js';

/** Helper to build a minimal ContextNode for testing */
function makeNode(overrides: Partial<ContextNode> & { id: string }): ContextNode {
  return {
    type: 'structural',
    tier: 'reference',
    content: overrides.content ?? `Content for ${overrides.id}`,
    origin: {
      source: '/workspace/CONSTITUTION.md',
      relativePath: 'CONSTITUTION.md',
      format: 'constitution',
      ...overrides.origin,
    },
    tokenEstimate: overrides.tokenEstimate ?? 100,
    ...overrides,
  };
}

/** Promote a ContextNode to RankedNode for trimming tests */
function makeRanked(node: ContextNode, relevance: number): RankedNode {
  return { ...node, relevance, reason: 'test' };
}

describe('rankNodes', () => {
  it('sorts nodes by tier weight descending', () => {
    const nodes: ContextNode[] = [
      makeNode({ id: 'ref', tier: 'reference' }), // 0.5
      makeNode({ id: 'const', tier: 'constitutional' }), // 1.0
      makeNode({ id: 'nav', tier: 'navigational' }), // 0.8
    ];

    const ranked = rankNodes(nodes);

    expect(ranked[0].id).toBe('const');
    expect(ranked[1].id).toBe('nav');
    expect(ranked[2].id).toBe('ref');
  });

  it('assigns correct relevance from tier weights', () => {
    const nodes: ContextNode[] = [
      makeNode({ id: 'const', tier: 'constitutional' }),
      makeNode({ id: 'hist', tier: 'historical' }),
    ];

    const ranked = rankNodes(nodes);

    expect(ranked.find((n) => n.id === 'const')!.relevance).toBe(1.0);
    expect(ranked.find((n) => n.id === 'hist')!.relevance).toBe(0.3);
  });

  it('applies task boost when taskHint matches node content', () => {
    const nodes: ContextNode[] = [
      makeNode({ id: 'git', tier: 'reference', content: 'Git discipline and branching' }),
      makeNode({ id: 'other', tier: 'reference', content: 'Unrelated content here' }),
    ];

    const ranked = rankNodes(nodes, 'git branching workflow');

    const gitNode = ranked.find((n) => n.id === 'git')!;
    const otherNode = ranked.find((n) => n.id === 'other')!;

    // Git node should have a boost from matching terms
    expect(gitNode.relevance).toBeGreaterThan(otherNode.relevance);
    expect(gitNode.reason).toContain('task boost');
  });

  it('caps relevance at 1.0 even with boost', () => {
    const nodes: ContextNode[] = [
      makeNode({
        id: 'const',
        tier: 'constitutional',
        content: 'constitutional content about purpose',
      }),
    ];

    const ranked = rankNodes(nodes, 'constitutional purpose content');

    expect(ranked[0].relevance).toBeLessThanOrEqual(1.0);
  });

  it('returns empty array for empty input', () => {
    expect(rankNodes([])).toEqual([]);
  });

  it('sets reason to tier name when no task boost', () => {
    const nodes: ContextNode[] = [makeNode({ id: 'n', tier: 'navigational' })];
    const ranked = rankNodes(nodes);
    expect(ranked[0].reason).toBe('navigational');
  });
});

describe('trimNodesToBudget', () => {
  it('includes all nodes when budget is sufficient', () => {
    const nodes: RankedNode[] = [
      makeRanked(makeNode({ id: 'a', tokenEstimate: 100 }), 1.0),
      makeRanked(makeNode({ id: 'b', tokenEstimate: 100 }), 0.5),
    ];

    const { included, trimmed } = trimNodesToBudget(nodes, 10000);

    expect(included).toHaveLength(2);
    expect(trimmed).toHaveLength(0);
  });

  it('trims nodes that exceed budget', () => {
    const nodes: RankedNode[] = [
      makeRanked(makeNode({ id: 'a', tokenEstimate: 500 }), 1.0),
      makeRanked(makeNode({ id: 'b', tokenEstimate: 500 }), 0.8),
      makeRanked(makeNode({ id: 'c', tokenEstimate: 500 }), 0.5),
    ];

    // Budget of 600 should fit first node + heading overhead, but not all three
    const { included, trimmed } = trimNodesToBudget(nodes, 600);

    expect(included.length).toBeGreaterThanOrEqual(1);
    expect(included.length).toBeLessThan(3);
    expect(included.length + trimmed.length).toBe(3);
  });

  it('returns empty included for zero budget', () => {
    const nodes: RankedNode[] = [makeRanked(makeNode({ id: 'a', tokenEstimate: 100 }), 1.0)];

    const { included, trimmed } = trimNodesToBudget(nodes, 0);

    expect(included).toHaveLength(0);
    expect(trimmed).toHaveLength(1);
  });

  it('handles empty input', () => {
    const { included, trimmed } = trimNodesToBudget([], 1000);
    expect(included).toEqual([]);
    expect(trimmed).toEqual([]);
  });

  it('preserves node order (pre-ranked input)', () => {
    const nodes: RankedNode[] = [
      makeRanked(makeNode({ id: 'first', tokenEstimate: 50 }), 1.0),
      makeRanked(makeNode({ id: 'second', tokenEstimate: 50 }), 0.8),
      makeRanked(makeNode({ id: 'third', tokenEstimate: 50 }), 0.5),
    ];

    const { included } = trimNodesToBudget(nodes, 10000);

    expect(included.map((n) => n.id)).toEqual(['first', 'second', 'third']);
  });
});
