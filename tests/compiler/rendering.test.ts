import { describe, it, expect } from 'vitest';
import {
  nodeNeedsHeading,
  renderNodeWithHeading,
  spokeQualifier,
} from '../../src/compiler/index.js';
import type { RankedNode } from '../../src/adapter/types.js';

function makeNode(overrides: Partial<RankedNode> & { content: string }): RankedNode {
  return {
    id: 'test',
    type: 'reference',
    tier: 'reference',
    content: overrides.content,
    origin: overrides.origin ?? {
      source: '/workspace/CONSTITUTION.md',
      relativePath: 'CONSTITUTION.md',
      format: 'constitution',
    },
    tokenEstimate: 10,
    relevance: 0.5,
    reason: 'test',
    ...overrides,
  };
}

describe('nodeNeedsHeading', () => {
  it('returns false when content starts with ATX heading', () => {
    const node = makeNode({ content: '# Already has heading\n\nBody text.' });
    expect(nodeNeedsHeading(node)).toBe(false);
  });

  it('returns false for h2-h6 headings', () => {
    expect(nodeNeedsHeading(makeNode({ content: '## H2 heading\n\nBody.' }))).toBe(false);
    expect(nodeNeedsHeading(makeNode({ content: '###### H6 heading' }))).toBe(false);
  });

  it('returns true for content starting with shell comment (not ATX heading)', () => {
    const node = makeNode({
      content: '#!/bin/bash\necho hello',
      origin: {
        source: '/ws/f.md',
        relativePath: 'f.md',
        format: 'markdown',
        headingPath: ['Scripts'],
      },
    });
    expect(nodeNeedsHeading(node)).toBe(true);
  });

  it('returns true for content without heading when headingPath exists', () => {
    const node = makeNode({
      content: 'Just some text.',
      origin: {
        source: '/ws/f.md',
        relativePath: 'f.md',
        format: 'constitution',
        headingPath: ['Purpose'],
      },
    });
    expect(nodeNeedsHeading(node)).toBe(true);
  });

  it('returns false when no headingPath', () => {
    const node = makeNode({
      content: 'Just some text.',
      origin: { source: '/ws/f.md', relativePath: 'f.md', format: 'constitution' },
    });
    expect(nodeNeedsHeading(node)).toBe(false);
  });

  it('returns false for empty headingPath', () => {
    const node = makeNode({
      content: 'Text.',
      origin: { source: '/ws/f.md', relativePath: 'f.md', format: 'constitution', headingPath: [] },
    });
    expect(nodeNeedsHeading(node)).toBe(false);
  });
});

describe('renderNodeWithHeading', () => {
  it('emits content as-is when it already has a heading', () => {
    const node = makeNode({ content: '## Existing\n\nBody.' });
    expect(renderNodeWithHeading(node)).toBe('## Existing\n\nBody.');
  });

  it('prepends heading from headingPath', () => {
    const node = makeNode({
      content: 'Some rules here.',
      origin: {
        source: '/ws/f.md',
        relativePath: 'CONSTITUTION.md',
        format: 'constitution',
        headingPath: ['Purpose'],
      },
    });
    expect(renderNodeWithHeading(node)).toBe('### Purpose\n\nSome rules here.');
  });

  it('appends spoke qualifier in parens', () => {
    const node = makeNode({
      content: 'Spoke content.',
      origin: {
        source: '/ws/career/CONSTITUTION.md',
        relativePath: 'career/CONSTITUTION.md',
        format: 'constitution',
        headingPath: ['Purpose'],
      },
    });
    expect(renderNodeWithHeading(node)).toBe('### Purpose (career)\n\nSpoke content.');
  });
});

describe('spokeQualifier', () => {
  it('returns undefined for root-level files', () => {
    const node = makeNode({
      origin: {
        source: '/ws/CONSTITUTION.md',
        relativePath: 'CONSTITUTION.md',
        format: 'constitution',
      },
    });
    expect(spokeQualifier(node)).toBeUndefined();
  });

  it('returns spoke name for spoke files', () => {
    const node = makeNode({
      origin: {
        source: '/ws/career/CONSTITUTION.md',
        relativePath: 'career/CONSTITUTION.md',
        format: 'constitution',
      },
    });
    expect(spokeQualifier(node)).toBe('career');
  });

  it('returns undefined for memory/Profile paths', () => {
    const node = makeNode({
      origin: {
        source: '/ws/memory/Profile/bio.md',
        relativePath: 'memory/Profile/bio.md',
        format: 'markdown',
      },
    });
    expect(spokeQualifier(node)).toBeUndefined();
  });

  it('returns memory for non-Profile memory paths', () => {
    const node = makeNode({
      origin: {
        source: '/ws/memory/Sessions/s.md',
        relativePath: 'memory/Sessions/s.md',
        format: 'markdown',
      },
    });
    expect(spokeQualifier(node)).toBe('memory');
  });

  it('returns undefined for .cursor paths', () => {
    const node = makeNode({
      origin: {
        source: '/ws/.cursor/rules/foo.mdc',
        relativePath: '.cursor/rules/foo.mdc',
        format: 'cursor',
      },
    });
    expect(spokeQualifier(node)).toBeUndefined();
  });

  it('handles forward slashes on all platforms', () => {
    const node = makeNode({
      origin: {
        source: '/ws/career/CONSTITUTION.md',
        relativePath: 'career/CONSTITUTION.md',
        format: 'constitution',
      },
    });
    expect(spokeQualifier(node)).toBe('career');
  });
});
