import { describe, it, expect } from 'vitest';
import { generateReadingList } from '../../src/navigation/reading-list.js';
import type { ConstitutionEntry } from '../../src/navigation/types.js';

function makeEntry(
  spokeName: string,
  purpose: string,
  entryPoints: string[] = [],
): ConstitutionEntry {
  return {
    path: `/workspace/${spokeName}/CONSTITUTION.md`,
    relativePath: `${spokeName}/CONSTITUTION.md`,
    spokeName,
    purpose,
    directorySemantics: new Map(),
    dependencies: [],
    excluded: [],
    entryPoints,
  };
}

describe('generateReadingList', () => {
  const index: ConstitutionEntry[] = [
    makeEntry('compiler', 'Compiles context from markdown sources', ['src/compiler/index.ts']),
    makeEntry('integrity', 'Validates claims against filesystem', ['src/integrity/claims.ts']),
    makeEntry('navigation', 'Indexes constitutions and generates reading lists', [
      'src/navigation/index.ts',
    ]),
    makeEntry('provider', 'Adapter interfaces for LLM providers', ['src/provider/interface.ts']),
    makeEntry('tools', 'Tool registry for agent tools', ['src/tools/registry.ts']),
  ];

  it('returns items relevant to the task', () => {
    const list = generateReadingList('fix the context compiler output', index);
    expect(list.task).toBe('fix the context compiler output');
    expect(list.items.length).toBeGreaterThan(0);
    // Compiler should appear since the task mentions "compiler" and "context"
    expect(list.items.some((i) => i.path.includes('compiler'))).toBe(true);
  });

  it('caps reading list at 10 items', () => {
    const manyEntries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`spoke-${i}`, `Spoke ${i} does something relevant to testing`, [
        `src/spoke-${i}/index.ts`,
      ]),
    );
    const list = generateReadingList('testing all spokes', manyEntries);
    expect(list.items.length).toBeLessThanOrEqual(10);
  });

  it('orders by priority (1 = most important)', () => {
    const list = generateReadingList('validate filesystem claims', index);
    expect(list.items.length).toBeGreaterThan(0);
    // Should be sorted by priority ascending
    for (let i = 1; i < list.items.length; i++) {
      expect(list.items[i].priority).toBeGreaterThanOrEqual(list.items[i - 1].priority);
    }
  });

  it('includes reason for each item', () => {
    const list = generateReadingList('fix compiler bug', index);
    for (const item of list.items) {
      expect(item.reason).toBeTruthy();
    }
  });
});
