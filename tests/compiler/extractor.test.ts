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

describe('extractAllLevel2 — h3 splitting', () => {
  it('splits h2 sections exceeding SPLIT_THRESHOLD at h3 boundaries', () => {
    // Create an h2 with enough content to exceed 500 tokens (~2000 chars)
    const longChild1 = 'First child content. '.repeat(60);
    const longChild2 = 'Second child content. '.repeat(60);
    const md = `# Top

## Big Section

Intro text.

### Child One

${longChild1}

### Child Two

${longChild2}
`;
    const nodes = parseMarkdown(md);
    const sections = extractAllLevel2(nodes, dummySource);

    // Should have 3 sections: intro (h2), Child One (h3), Child Two (h3)
    expect(sections.length).toBe(3);
    expect(sections[0].headingPath).toEqual(['Top', 'Big Section']);
    expect(sections[0].content).toContain('Intro text.');
    expect(sections[1].headingPath).toEqual(['Top', 'Big Section', 'Child One']);
    expect(sections[1].content).toContain('First child content.');
    expect(sections[2].headingPath).toEqual(['Top', 'Big Section', 'Child Two']);
    expect(sections[2].content).toContain('Second child content.');
  });

  it('emits h2 intro-only section when there is non-trivial intro text before h3s', () => {
    const longChild = 'Padding content here. '.repeat(120);
    const md = `# Root

## Section With Intro

This is important introductory text.

### Sub Section

${longChild}
`;
    const nodes = parseMarkdown(md);
    const sections = extractAllLevel2(nodes, dummySource);

    // Intro section should exist and contain the intro text
    const introSection = sections.find(
      (s) => s.headingPath.length === 2 && s.headingPath[1] === 'Section With Intro',
    );
    expect(introSection).toBeDefined();
    expect(introSection!.content).toContain('This is important introductory text.');
    // Intro should NOT contain child content
    expect(introSection!.content).not.toContain('Padding content here.');
  });

  it('does not split when section is under threshold', () => {
    const md = `# Top

## Small Section

Short content.

### Sub A

Also short.

### Sub B

Brief.
`;
    const nodes = parseMarkdown(md);
    const sections = extractAllLevel2(nodes, dummySource);

    // Should be kept as one section since total tokens < 500
    expect(sections).toHaveLength(1);
    expect(sections[0].headingPath).toEqual(['Top', 'Small Section']);
    expect(sections[0].content).toContain('Short content.');
    expect(sections[0].content).toContain('Also short.');
  });

  it('does not split when h3 children are absent', () => {
    // Large h2 with no h3 children — should not be split
    const longContent = 'Lots of text without sub-headings. '.repeat(80);
    const md = `# Top

## Monolithic Section

${longContent}
`;
    const nodes = parseMarkdown(md);
    const sections = extractAllLevel2(nodes, dummySource);

    expect(sections).toHaveLength(1);
    expect(sections[0].headingPath).toEqual(['Top', 'Monolithic Section']);
    expect(sections[0].content).toContain('Lots of text without sub-headings.');
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
