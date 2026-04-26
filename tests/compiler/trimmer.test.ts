import { describe, it, expect } from 'vitest';
import { estimateTokens, trimToBudget } from '../../src/compiler/trimmer.js';
import type { RankedSection, ContextSource } from '../../src/compiler/types.js';

function makeRankedSection(
  relevance: number,
  content: string,
  name: string = 'Section',
): RankedSection {
  const source: ContextSource = {
    path: '/test/file.md',
    kind: 'constitution',
    relativePath: 'file.md',
  };
  return {
    source,
    headingPath: [name],
    level: 1,
    content,
    tokenEstimate: estimateTokens(content),
    relevance,
    reason: 'test',
  };
}

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it('rounds up partial tokens', () => {
    const text = 'a'.repeat(10);
    expect(estimateTokens(text)).toBe(3); // 10/4 = 2.5, rounds to 3
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('trimToBudget', () => {
  it('includes all sections when under budget', () => {
    const sections = [
      makeRankedSection(1.0, 'a'.repeat(40), 'High'),
      makeRankedSection(0.5, 'b'.repeat(40), 'Med'),
      makeRankedSection(0.3, 'c'.repeat(40), 'Low'),
    ];
    const result = trimToBudget(sections, 1000);
    expect(result.included).toHaveLength(3);
    expect(result.trimmed).toHaveLength(0);
  });

  it('drops lowest-relevance sections first', () => {
    const sections = [
      makeRankedSection(1.0, 'a'.repeat(40), 'High'), // 10 tokens
      makeRankedSection(0.5, 'b'.repeat(40), 'Med'), // 10 tokens
      makeRankedSection(0.3, 'c'.repeat(40), 'Low'), // 10 tokens
    ];
    // Budget for only ~20 tokens (two sections)
    const result = trimToBudget(sections, 20);
    expect(result.included).toHaveLength(2);
    expect(result.trimmed).toHaveLength(1);
    // The trimmed section should be the lowest relevance
    expect(result.trimmed[0].headingPath[0]).toBe('Low');
    // Included should have highest relevance sections
    expect(result.included.some((s) => s.headingPath[0] === 'High')).toBe(true);
    expect(result.included.some((s) => s.headingPath[0] === 'Med')).toBe(true);
  });

  it('reports trimmed sections', () => {
    const sections = [
      makeRankedSection(1.0, 'a'.repeat(200), 'Big'), // 50 tokens
      makeRankedSection(0.5, 'b'.repeat(200), 'Also Big'), // 50 tokens
    ];
    const result = trimToBudget(sections, 60);
    expect(result.included).toHaveLength(1);
    expect(result.trimmed).toHaveLength(1);
    expect(result.trimmed[0].headingPath[0]).toBe('Also Big');
  });

  it('handles empty sections list', () => {
    const result = trimToBudget([], 1000);
    expect(result.included).toHaveLength(0);
    expect(result.trimmed).toHaveLength(0);
  });

  describe('cross-source dedup', () => {
    it('removes lower-relevance duplicate heading from a different source', () => {
      const sourceA: ContextSource = {
        path: '/test/a.md',
        kind: 'constitution',
        relativePath: 'a.md',
      };
      const sourceB: ContextSource = {
        path: '/test/b.md',
        kind: 'reference',
        relativePath: 'b.md',
      };

      const sections: RankedSection[] = [
        {
          source: sourceA,
          headingPath: ['Architecture'],
          level: 1,
          content: 'Architecture from source A.',
          tokenEstimate: 7,
          relevance: 0.9,
          reason: 'constitutional',
        },
        {
          source: sourceB,
          headingPath: ['Architecture'],
          level: 1,
          content: 'Architecture from source B.',
          tokenEstimate: 7,
          relevance: 0.5,
          reason: 'reference',
        },
      ];

      const result = trimToBudget(sections, 1000);
      // Higher-relevance copy from source A should be included
      expect(result.included).toHaveLength(1);
      expect(result.included[0].source.relativePath).toBe('a.md');
      // Lower-relevance copy from source B should be trimmed
      expect(result.trimmed).toHaveLength(1);
      expect(result.trimmed[0].source.relativePath).toBe('b.md');
    });

    it('keeps same heading from same source (no false dedup)', () => {
      const source: ContextSource = {
        path: '/test/file.md',
        kind: 'constitution',
        relativePath: 'file.md',
      };

      const sections: RankedSection[] = [
        {
          source,
          headingPath: ['Entry Points'],
          level: 1,
          content: 'First entry points section.',
          tokenEstimate: 7,
          relevance: 0.9,
          reason: 'navigational',
        },
        {
          source,
          headingPath: ['Entry Points'],
          level: 1,
          content: 'Second entry points section.',
          tokenEstimate: 7,
          relevance: 0.7,
          reason: 'navigational',
        },
      ];

      const result = trimToBudget(sections, 1000);
      // Both should be included — same source, no dedup
      expect(result.included).toHaveLength(2);
      expect(result.trimmed).toHaveLength(0);
    });

    it('dedup interacts correctly with budget enforcement', () => {
      const sourceA: ContextSource = {
        path: '/test/a.md',
        kind: 'constitution',
        relativePath: 'a.md',
      };
      const sourceB: ContextSource = {
        path: '/test/b.md',
        kind: 'reference',
        relativePath: 'b.md',
      };

      const sections: RankedSection[] = [
        {
          source: sourceA,
          headingPath: ['Purpose'],
          level: 1,
          content: 'a'.repeat(40), // 10 tokens
          tokenEstimate: 10,
          relevance: 1.0,
          reason: 'constitutional',
        },
        {
          source: sourceB,
          headingPath: ['Purpose'],
          level: 1,
          content: 'b'.repeat(40), // 10 tokens
          tokenEstimate: 10,
          relevance: 0.6,
          reason: 'reference',
        },
        {
          source: sourceA,
          headingPath: ['Services'],
          level: 1,
          content: 'c'.repeat(40), // 10 tokens
          tokenEstimate: 10,
          relevance: 0.5,
          reason: 'reference',
        },
      ];

      // Budget for 20 tokens. Purpose from B is deduped, Services fits.
      const result = trimToBudget(sections, 20);
      expect(result.included).toHaveLength(2);
      expect(result.included.some((s) => s.headingPath[0] === 'Purpose')).toBe(true);
      expect(result.included.some((s) => s.headingPath[0] === 'Services')).toBe(true);
      // Purpose from source B should be in trimmed (dedup)
      expect(result.trimmed).toHaveLength(1);
      expect(result.trimmed[0].headingPath[0]).toBe('Purpose');
      expect(result.trimmed[0].source.relativePath).toBe('b.md');
    });
  });
});
