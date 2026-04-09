import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/compiler/parser.js';
import { extractSection, extractAllLevel2, cleanContent } from '../../src/compiler/extractor.js';
import type { ContextSource } from '../../src/compiler/types.js';

const dummySource: ContextSource = {
  path: '/test/file.md',
  kind: 'constitution',
  relativePath: 'file.md',
};

describe('extractSection', () => {
  const md = `# Architecture

Overview text.

## Hub-and-Spoke Model

The hub coordinates spokes.

### Spoke Details

Each spoke is independent.

## Services

Service registry info.

# Other Section

Other content.
`;

  it('extracts top-level section by name', () => {
    const nodes = parseMarkdown(md);
    const section = extractSection(nodes, ['Architecture'], dummySource);
    expect(section).not.toBeNull();
    expect(section!.headingPath).toEqual(['Architecture']);
    expect(section!.content).toContain('Overview text.');
  });

  it('extracts nested section by path', () => {
    const nodes = parseMarkdown(md);
    const section = extractSection(nodes, ['Architecture', 'Hub-and-Spoke Model'], dummySource);
    expect(section).not.toBeNull();
    expect(section!.headingPath).toEqual(['Architecture', 'Hub-and-Spoke Model']);
    expect(section!.content).toContain('The hub coordinates spokes.');
  });

  it('returns null for non-existent path', () => {
    const nodes = parseMarkdown(md);
    const section = extractSection(nodes, ['Nonexistent'], dummySource);
    expect(section).toBeNull();
  });

  it('includes content up to next same-level heading', () => {
    const nodes = parseMarkdown(md);
    const section = extractSection(nodes, ['Architecture', 'Hub-and-Spoke Model'], dummySource);
    expect(section).not.toBeNull();
    expect(section!.content).toContain('The hub coordinates spokes.');
    // Should NOT contain the next H2 section content
    expect(section!.content).not.toContain('Service registry info.');
  });
});

describe('extractAllLevel2', () => {
  it('extracts all level-2 sections', () => {
    const md = `# Top

Intro.

## First Section

First content.

## Second Section

Second content.

## Third Section

Third content.
`;
    const nodes = parseMarkdown(md);
    const sections = extractAllLevel2(nodes, dummySource);
    expect(sections).toHaveLength(3);
    expect(sections[0].headingPath[sections[0].headingPath.length - 1]).toBe('First Section');
    expect(sections[1].headingPath[sections[1].headingPath.length - 1]).toBe('Second Section');
    expect(sections[2].headingPath[sections[2].headingPath.length - 1]).toBe('Third Section');
  });
});

describe('cleanContent', () => {
  it('removes See: references', () => {
    const content = `Some text here.

See: memory/Observations/pattern.md

More text.`;
    const cleaned = cleanContent(content);
    expect(cleaned).not.toContain('See:');
    expect(cleaned).toContain('Some text here.');
    expect(cleaned).toContain('More text.');
  });

  it('removes Applied in: references', () => {
    const content = `Description.

Applied in: scripts/build.py, command_center/main.py

Next paragraph.`;
    const cleaned = cleanContent(content);
    expect(cleaned).not.toContain('Applied in:');
    expect(cleaned).toContain('Description.');
  });

  it('collapses consecutive blank lines', () => {
    const content = `First line.



Second line.




Third line.`;
    const cleaned = cleanContent(content);
    // Should have at most one blank line between paragraphs
    expect(cleaned).not.toMatch(/\n{3,}/);
    expect(cleaned).toContain('First line.');
    expect(cleaned).toContain('Second line.');
    expect(cleaned).toContain('Third line.');
  });

  it('trims whitespace', () => {
    const content = `

  Content with whitespace.

`;
    const cleaned = cleanContent(content);
    expect(cleaned).toBe('Content with whitespace.');
  });
});
