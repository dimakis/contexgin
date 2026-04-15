import { describe, it, expect } from 'vitest';
import {
  slugify,
  TIER_WEIGHTS,
  type ContextNode,
  type ContextAdapter,
  type ContextNodeType,
  type ContextTier,
  type SourceFormat,
} from '../../src/adapter/types.js';

describe('ContextNode type system', () => {
  it('supports all five node types', () => {
    const types: ContextNodeType[] = [
      'structural',
      'operational',
      'identity',
      'governance',
      'reference',
    ];
    expect(types).toHaveLength(5);
  });

  it('supports all five tiers', () => {
    const tiers: ContextTier[] = [
      'constitutional',
      'navigational',
      'identity',
      'reference',
      'historical',
    ];
    expect(tiers).toHaveLength(5);
  });

  it('supports all four source formats', () => {
    const formats: SourceFormat[] = ['claude_md', 'cursor_rules', 'constitution', 'markdown'];
    expect(formats).toHaveLength(4);
  });

  it('constructs a valid ContextNode', () => {
    const node: ContextNode = {
      id: 'git-discipline',
      type: 'operational',
      tier: 'navigational',
      content: 'All commits use conventional commits.',
      origin: {
        source: '/workspace/CLAUDE.md',
        relativePath: 'CLAUDE.md',
        format: 'claude_md',
        headingPath: ['Git Discipline'],
      },
      tokenEstimate: 8,
    };

    expect(node.id).toBe('git-discipline');
    expect(node.type).toBe('operational');
    expect(node.tier).toBe('navigational');
    expect(node.origin.format).toBe('claude_md');
    expect(node.origin.headingPath).toEqual(['Git Discipline']);
  });

  it('constructs a node without optional headingPath', () => {
    const node: ContextNode = {
      id: 'boot-context',
      type: 'operational',
      tier: 'navigational',
      content: 'Always apply this rule.',
      origin: {
        source: '/workspace/.cursor/rules/boot.mdc',
        relativePath: '.cursor/rules/boot.mdc',
        format: 'cursor_rules',
      },
      tokenEstimate: 6,
    };

    expect(node.origin.headingPath).toBeUndefined();
  });
});

describe('TIER_WEIGHTS', () => {
  it('has weights for all five tiers', () => {
    expect(Object.keys(TIER_WEIGHTS)).toHaveLength(5);
  });

  it('ranks constitutional highest', () => {
    expect(TIER_WEIGHTS.constitutional).toBe(1.0);
    expect(TIER_WEIGHTS.constitutional).toBeGreaterThan(TIER_WEIGHTS.navigational);
  });

  it('ranks historical lowest', () => {
    expect(TIER_WEIGHTS.historical).toBe(0.3);
    expect(TIER_WEIGHTS.historical).toBeLessThan(TIER_WEIGHTS.reference);
  });

  it('tiers are in descending order', () => {
    const ordered = [
      TIER_WEIGHTS.constitutional,
      TIER_WEIGHTS.navigational,
      TIER_WEIGHTS.identity,
      TIER_WEIGHTS.reference,
      TIER_WEIGHTS.historical,
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(ordered[i]).toBeGreaterThan(ordered[i + 1]);
    }
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Git Discipline')).toBe('git-discipline');
  });

  it('strips special characters', () => {
    expect(slugify('Entry Points & CLI')).toBe('entry-points-cli');
  });

  it('collapses multiple separators', () => {
    expect(slugify('Foo --- Bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('ContextAdapter interface', () => {
  it('can be implemented', () => {
    const adapter: ContextAdapter = {
      format: 'markdown',
      canHandle: (filePath: string) => filePath.endsWith('.md'),
      adapt: async () => [],
    };

    expect(adapter.format).toBe('markdown');
    expect(adapter.canHandle('README.md')).toBe(true);
    expect(adapter.canHandle('foo.ts')).toBe(false);
  });
});
