import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { validateDocClaims, findByGlob, extractStem } from '../../src/integrity/doc-validator.js';
import type { CountClaim, ListClaim } from '../../src/integrity/types.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../fixtures/doc-consistency');

describe('findByGlob', () => {
  it('finds files matching a simple glob', async () => {
    const matches = await findByGlob('src/modules/*.ts', FIXTURE_ROOT);
    expect(matches).toHaveLength(3);
    expect(matches).toContain('src/modules/alpha.ts');
    expect(matches).toContain('src/modules/beta.ts');
    expect(matches).toContain('src/modules/gamma.ts');
  });

  it('finds files matching a nested glob', async () => {
    const matches = await findByGlob('src/agents/*.ts', FIXTURE_ROOT);
    expect(matches).toHaveLength(2);
    expect(matches).toContain('src/agents/scout.ts');
    expect(matches).toContain('src/agents/builder.ts');
  });

  it('returns empty for non-matching patterns', async () => {
    const matches = await findByGlob('src/nonexistent/*.ts', FIXTURE_ROOT);
    expect(matches).toHaveLength(0);
  });

  it('handles ** double-star glob', async () => {
    const matches = await findByGlob('**/*.ts', FIXTURE_ROOT);
    expect(matches.length).toBeGreaterThanOrEqual(5);
    expect(matches).toContain('src/modules/alpha.ts');
    expect(matches).toContain('src/agents/scout.ts');
  });
});

describe('extractStem', () => {
  it('extracts filename without extension', () => {
    expect(extractStem('src/modules/alpha.ts')).toBe('alpha');
    expect(extractStem('README.md')).toBe('README');
  });

  it('handles files without extension', () => {
    expect(extractStem('Makefile')).toBe('Makefile');
  });
});

describe('validateDocClaims', () => {
  describe('count_matches', () => {
    it('validates correct count', async () => {
      const claims: CountClaim[] = [
        {
          source: 'README.md',
          assertion: 'README.md claims 3 modules matching src/modules/*.ts',
          kind: 'count_matches',
          target: 'src/modules/*.ts',
          line: 5,
          expectedCount: 3,
          noun: 'modules',
        },
      ];

      const results = await validateDocClaims(claims, FIXTURE_ROOT);
      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(true);
      expect(results[0].message).toContain('confirmed');
    });

    it('reports incorrect count', async () => {
      const claims: CountClaim[] = [
        {
          source: 'README.md',
          assertion: 'README.md claims 5 modules matching src/modules/*.ts',
          kind: 'count_matches',
          target: 'src/modules/*.ts',
          line: 5,
          expectedCount: 5,
          noun: 'modules',
        },
      ];

      const results = await validateDocClaims(claims, FIXTURE_ROOT);
      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(false);
      expect(results[0].actual).toBe('3');
      expect(results[0].message).toContain('claims 5');
      expect(results[0].message).toContain('found 3');
    });
  });

  describe('list_complete', () => {
    it('validates complete list', async () => {
      const claims: ListClaim[] = [
        {
          source: 'README.md',
          assertion: 'README.md lists 3 items that should match src/modules/*.ts',
          kind: 'list_complete',
          target: 'src/modules/*.ts',
          line: 5,
          listedItems: ['alpha', 'beta', 'gamma'],
        },
      ];

      const results = await validateDocClaims(claims, FIXTURE_ROOT);
      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(true);
      expect(results[0].message).toContain('complete');
    });

    it('reports items in doc but not on disk', async () => {
      const claims: ListClaim[] = [
        {
          source: 'README.md',
          assertion: 'test',
          kind: 'list_complete',
          target: 'src/modules/*.ts',
          line: 5,
          listedItems: ['alpha', 'beta', 'gamma', 'delta'],
        },
      ];

      const results = await validateDocClaims(claims, FIXTURE_ROOT);
      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('documented but not found');
      expect(results[0].message).toContain('delta');
    });

    it('reports items on disk but not in doc', async () => {
      const claims: ListClaim[] = [
        {
          source: 'README.md',
          assertion: 'test',
          kind: 'list_complete',
          target: 'src/modules/*.ts',
          line: 5,
          listedItems: ['alpha', 'beta'],
        },
      ];

      const results = await validateDocClaims(claims, FIXTURE_ROOT);
      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('found but not documented');
      expect(results[0].message).toContain('gamma');
    });

    it('reports both missing and extra items', async () => {
      const claims: ListClaim[] = [
        {
          source: 'README.md',
          assertion: 'test',
          kind: 'list_complete',
          target: 'src/modules/*.ts',
          line: 5,
          listedItems: ['alpha', 'beta', 'delta'],
        },
      ];

      const results = await validateDocClaims(claims, FIXTURE_ROOT);
      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('delta');
      expect(results[0].message).toContain('gamma');
    });
  });

  it('skips non-doc claim kinds', async () => {
    const claims = [
      {
        source: 'test',
        assertion: 'test',
        kind: 'file_exists' as const,
        target: 'src/index.ts',
        line: 1,
      },
    ];

    const results = await validateDocClaims(claims, FIXTURE_ROOT);
    expect(results).toHaveLength(0);
  });
});
