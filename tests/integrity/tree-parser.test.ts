import { describe, it, expect } from 'vitest';
import { parseAsciiTree, buildDeclaredTree } from '../../src/integrity/tree-parser.js';

describe('parseAsciiTree', () => {
  it('parses a simple tree with directories', () => {
    const content = `## Architecture

\`\`\`
project/                           <- you are here (hub)
├── src/                          <- Source code
├── tests/                        <- Test suite
└── docs/                         <- Documentation
\`\`\`
`;
    const { nodes } = parseAsciiTree(content);
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => n.type === 'directory')).toBe(true);
    expect(nodes.map((n) => n.path)).toEqual(['src/', 'tests/', 'docs/']);
  });

  it('handles 2-level nesting', () => {
    const content = `\`\`\`
project/                           <- root
├── command_center/                <- Briefings
│   ├── lib/                      <- Shared utilities
│   └── config/                   <- Pipeline configuration
└── memory/                        <- Long-term memory
\`\`\`
`;
    const { nodes } = parseAsciiTree(content);
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => n.path)).toEqual([
      'command_center/',
      'command_center/lib/',
      'command_center/config/',
      'memory/',
    ]);
  });

  it('extracts inline comments as descriptions', () => {
    const content = `\`\`\`
project/
├── src/                          <- Source code
└── docs/                         <- Documentation files
\`\`\`
`;
    const { nodes } = parseAsciiTree(content);
    expect(nodes[0].description).toBe('Source code');
    expect(nodes[1].description).toBe('Documentation files');
  });

  it('extracts external references separately', () => {
    const content = `\`\`\`
mgmt/                              <- you are here (hub)
├── command_center/                <- Briefings
├── [external] ~/tools/mitzo/     <- Mitzo agent harness
└── [external] ~/projects/contexgin/ <- Context engine
\`\`\`
`;
    const { nodes, externals } = parseAsciiTree(content);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].path).toBe('command_center/');
    expect(externals).toHaveLength(2);
    expect(externals[0].path).toBe('~/tools/mitzo/');
    expect(externals[1].path).toBe('~/projects/contexgin/');
  });

  it('strips root line from child paths', () => {
    const content = `\`\`\`
my-project/                        <- root
├── src/
└── package.json
\`\`\`
`;
    const { nodes } = parseAsciiTree(content);
    // Paths should be relative, not prefixed with "my-project/"
    expect(nodes.map((n) => n.path)).toEqual(['src/', 'package.json']);
  });

  it('distinguishes files from directories', () => {
    const content = `\`\`\`
project/
├── src/
├── package.json
└── README.md
\`\`\`
`;
    const { nodes } = parseAsciiTree(content);
    expect(nodes.find((n) => n.path === 'src/')?.type).toBe('directory');
    expect(nodes.find((n) => n.path === 'package.json')?.type).toBe('file');
    expect(nodes.find((n) => n.path === 'README.md')?.type).toBe('file');
  });

  it('handles content with no tree blocks', () => {
    const content = `## Architecture\n\nJust some text, no tree here.`;
    const { nodes, externals } = parseAsciiTree(content);
    expect(nodes).toHaveLength(0);
    expect(externals).toHaveLength(0);
  });

  it('handles the real mgmt tree format', () => {
    const content = `\`\`\`
mgmt/                              ← you are here (hub)
├── command_center/                ← Briefings, meeting prep, inbox pipeline
│   ├── lib/                      ← Shared utilities (gws_client, formatters, meeting_context)
│   ├── config/                   ← Pipeline configuration (inbox_pipeline.yaml)
│   └── briefings/                ← Generated output (gitignored)
├── memory/                        ← Claude's long-term memory (Obsidian vault)
├── views/                         ← Pluggable status views (engineer, manager)
├── professional/                  ← Professional presence (blog + LinkedIn)
│   ├── blog/                     ← Content creation pipeline
│   └── linkedin/                 ← Profile + presence management
├── [external] ~/tools/mitzo/     ← Mitzo — web-based Claude command center (Agent SDK)
└── okrs/
    ├── private_eng_excellence/    ← Private steward workspace (confidential)
    └── shared_eng_excellence/     ← Team-facing OKR 3 repo (shared)
\`\`\`
`;
    const { nodes, externals } = parseAsciiTree(content);

    // Should find all non-external directories
    expect(nodes.some((n) => n.path === 'command_center/')).toBe(true);
    expect(nodes.some((n) => n.path === 'command_center/lib/')).toBe(true);
    expect(nodes.some((n) => n.path === 'memory/')).toBe(true);
    expect(nodes.some((n) => n.path === 'professional/')).toBe(true);
    expect(nodes.some((n) => n.path === 'professional/blog/')).toBe(true);
    expect(nodes.some((n) => n.path === 'okrs/')).toBe(true);
    expect(nodes.some((n) => n.path === 'okrs/private_eng_excellence/')).toBe(true);

    // External ref
    expect(externals).toHaveLength(1);
    expect(externals[0].path).toBe('~/tools/mitzo/');
  });
});

describe('buildDeclaredTree', () => {
  it('merges table semantics with tree nodes', () => {
    const semantics = new Map([
      ['command_center/', 'Briefings and meeting prep'],
      ['memory/', "Claude's long-term memory"],
      ['docs/', 'Design documents'],
    ]);

    const treeContent = `\`\`\`
project/
├── command_center/                ← Briefings
├── memory/                        ← Memory vault
└── views/                         ← Status views
\`\`\`
`;
    const { nodes } = buildDeclaredTree(semantics, treeContent);

    // command_center/ and memory/ appear in both
    const cc = nodes.find((n) => n.path === 'command_center/');
    expect(cc?.source).toBe('both');

    // docs/ only in table
    const docs = nodes.find((n) => n.path === 'docs/');
    expect(docs?.source).toBe('table');

    // views/ only in tree
    const views = nodes.find((n) => n.path === 'views/');
    expect(views?.source).toBe('tree');
  });

  it('works with table only (no tree)', () => {
    const semantics = new Map([
      ['src/', 'Source code'],
      ['tests/', 'Test files'],
    ]);

    const { nodes } = buildDeclaredTree(semantics, 'No tree here');
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.source === 'table')).toBe(true);
  });

  it('works with tree only (no table)', () => {
    const treeContent = `\`\`\`
project/
├── src/
└── tests/
\`\`\`
`;
    const { nodes } = buildDeclaredTree(new Map(), treeContent);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.source === 'tree')).toBe(true);
  });
});
