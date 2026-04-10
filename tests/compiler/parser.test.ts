import { describe, it, expect } from 'vitest';
import { parseMarkdown, stripFrontmatter, type HeadingNode } from '../../src/compiler/parser.js';

describe('parseMarkdown', () => {
  it('parses flat heading list', () => {
    const md = `# Heading One

Content one.

# Heading Two

Content two.
`;
    const nodes = parseMarkdown(md);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].title).toBe('Heading One');
    expect(nodes[0].level).toBe(1);
    expect(nodes[0].content).toContain('Content one.');
    expect(nodes[1].title).toBe('Heading Two');
    expect(nodes[1].content).toContain('Content two.');
  });

  it('builds nested heading tree (H2 under H1, H3 under H2)', () => {
    const md = `# Top Level

Intro text.

## Second Level

Second content.

### Third Level

Third content.

## Another Second

More content.
`;
    const nodes = parseMarkdown(md);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].title).toBe('Top Level');
    expect(nodes[0].children).toHaveLength(2);
    expect(nodes[0].children[0].title).toBe('Second Level');
    expect(nodes[0].children[0].children).toHaveLength(1);
    expect(nodes[0].children[0].children[0].title).toBe('Third Level');
    expect(nodes[0].children[1].title).toBe('Another Second');
  });

  it('handles heading-only sections (no body content)', () => {
    const md = `# Empty Section

## Also Empty

## Has Content

Some content here.
`;
    const nodes = parseMarkdown(md);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toHaveLength(2);
    expect(nodes[0].children[0].title).toBe('Also Empty');
    expect(nodes[0].children[0].content.trim()).toBe('');
    expect(nodes[0].children[1].content).toContain('Some content here.');
  });

  it('preserves content between headings', () => {
    const md = `# Title

First paragraph.

Second paragraph.

- List item 1
- List item 2

# Next
`;
    const nodes = parseMarkdown(md);
    expect(nodes[0].content).toContain('First paragraph.');
    expect(nodes[0].content).toContain('Second paragraph.');
    expect(nodes[0].content).toContain('- List item 1');
    expect(nodes[0].content).toContain('- List item 2');
  });

  it('handles code blocks containing # characters', () => {
    const md = `# Real Heading

Some text.

\`\`\`bash
# This is a comment, not a heading
echo "hello"
## Also not a heading
\`\`\`

More text after code block.

# Another Real Heading

Final content.
`;
    const nodes = parseMarkdown(md);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].title).toBe('Real Heading');
    expect(nodes[0].content).toContain('# This is a comment, not a heading');
    expect(nodes[0].content).toContain('## Also not a heading');
    expect(nodes[0].content).toContain('More text after code block.');
    expect(nodes[1].title).toBe('Another Real Heading');
  });

  it('handles content before any heading', () => {
    const md = `Some preamble text.

# First Heading

Content.
`;
    const nodes = parseMarkdown(md);
    // Preamble becomes a virtual root or is ignored — first heading is still found
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    const headingNode = nodes.find((n) => n.title === 'First Heading');
    expect(headingNode).toBeDefined();
  });

  it('records line numbers', () => {
    const md = `# First

Content.

## Second

More content.
`;
    const nodes = parseMarkdown(md);
    expect(nodes[0].line).toBe(1);
    expect(nodes[0].children[0].line).toBe(5);
  });
});

describe('stripFrontmatter', () => {
  it('strips YAML frontmatter between --- delimiters', () => {
    const md = `---
title: Test
date: 2024-01-01
---

# Real Content

Text here.
`;
    const result = stripFrontmatter(md);
    expect(result).not.toContain('title: Test');
    expect(result).toContain('# Real Content');
    expect(result).toContain('Text here.');
  });

  it('returns unchanged content without frontmatter', () => {
    const md = `# No Frontmatter

Just regular content.
`;
    const result = stripFrontmatter(md);
    expect(result).toBe(md);
  });

  it('handles frontmatter with complex YAML', () => {
    const md = `---
title: "Complex: Title"
tags:
  - one
  - two
nested:
  key: value
---

# Content
`;
    const result = stripFrontmatter(md);
    expect(result).not.toContain('tags:');
    expect(result).toContain('# Content');
  });
});
