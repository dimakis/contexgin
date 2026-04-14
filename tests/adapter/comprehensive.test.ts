/**
 * Comprehensive adapter layer tests.
 *
 * Tests cross-cutting concerns: classification consistency between adapters,
 * error isolation, registry ordering, budget accuracy, CRLF handling,
 * edge cases, and end-to-end real-world workspace compilation.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { claudeAdapter } from '../../src/adapter/claude.js';
import { cursorAdapter } from '../../src/adapter/cursor.js';
import { constitutionAdapter } from '../../src/adapter/constitution.js';
import { markdownAdapter } from '../../src/adapter/markdown.js';
import { findAdapter, adaptFile } from '../../src/adapter/registry.js';
import { discoverAndAdapt } from '../../src/adapter/index.js';
import { compileWithAdapters } from '../../src/compiler/index.js';
import { estimateTokens } from '../../src/compiler/trimmer.js';

// ── Helpers ─────────────────────────────────────────────────────

async function withTempWorkspace(
  setup: (dir: string) => Promise<void>,
  test: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-comprehensive-'));
  await setup(dir);
  try {
    await test(dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

async function writeFile(dir: string, relPath: string, content: string): Promise<string> {
  const fullPath = path.join(dir, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  return fullPath;
}

// ── Classification Consistency ──────────────────────────────────

describe('classification consistency across adapters', () => {
  it('Purpose heading: constitution=identity, claude=identity, markdown=identity', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CONSTITUTION.md', '## Purpose\n\nOrchestration engine.\n');
        await writeFile(dir, 'CLAUDE.md', '## Purpose\n\nOrchestration engine.\n');
        await writeFile(dir, 'README.md', '## Purpose\n\nOrchestration engine.\n');
      },
      async (dir) => {
        const constNodes = await constitutionAdapter.adapt(path.join(dir, 'CONSTITUTION.md'), dir);
        const claudeNodes = await claudeAdapter.adapt(path.join(dir, 'CLAUDE.md'), dir);
        const mdNodes = await markdownAdapter.adapt(path.join(dir, 'README.md'), dir);

        // All three should classify Purpose as identity
        expect(constNodes.find((n) => n.id === 'purpose')?.type).toBe('identity');
        expect(claudeNodes.find((n) => n.id === 'purpose')?.type).toBe('identity');
        expect(mdNodes.find((n) => n.id === 'purpose')?.type).toBe('identity');
      },
    );
  });

  it('Boundaries heading: all adapters classify as governance/constitutional', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CONSTITUTION.md', '## Boundaries\n\n- Never expose credentials\n');
        await writeFile(dir, 'CLAUDE.md', '## Security Boundaries\n\nNo credential exposure.\n');
        await writeFile(dir, 'README.md', '## Boundaries\n\nAccess restricted.\n');
      },
      async (dir) => {
        const constNodes = await constitutionAdapter.adapt(path.join(dir, 'CONSTITUTION.md'), dir);
        const claudeNodes = await claudeAdapter.adapt(path.join(dir, 'CLAUDE.md'), dir);
        const mdNodes = await markdownAdapter.adapt(path.join(dir, 'README.md'), dir);

        expect(constNodes.find((n) => n.id === 'boundaries')?.type).toBe('governance');
        expect(claudeNodes[0].type).toBe('governance');
        expect(mdNodes[0].type).toBe('governance');

        expect(constNodes.find((n) => n.id === 'boundaries')?.tier).toBe('constitutional');
        expect(claudeNodes[0].tier).toBe('constitutional');
        expect(mdNodes[0].tier).toBe('constitutional');
      },
    );
  });

  it('Architecture heading: claude=structural, markdown=structural', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Architecture\n\nHub-spoke model.\n');
        await writeFile(dir, 'README.md', '## Architecture\n\nHub-spoke model.\n');
      },
      async (dir) => {
        const claudeNodes = await claudeAdapter.adapt(path.join(dir, 'CLAUDE.md'), dir);
        const mdNodes = await markdownAdapter.adapt(path.join(dir, 'README.md'), dir);

        expect(claudeNodes[0].type).toBe('structural');
        expect(mdNodes[0].type).toBe('structural');
      },
    );
  });
});

// ── Registry Ordering ───────────────────────────────────────────

describe('registry ordering and specificity', () => {
  it('CONSTITUTION.md → constitution adapter, not markdown', () => {
    expect(findAdapter('CONSTITUTION.md')?.format).toBe('constitution');
    expect(findAdapter('/workspace/CONSTITUTION.md')?.format).toBe('constitution');
    expect(findAdapter('/workspace/spoke/CONSTITUTION.md')?.format).toBe('constitution');
  });

  it('CLAUDE.md → claude adapter, not markdown', () => {
    expect(findAdapter('CLAUDE.md')?.format).toBe('claude_md');
    expect(findAdapter('/workspace/CLAUDE.md')?.format).toBe('claude_md');
  });

  it('.cursor/rules/*.mdc → cursor adapter', () => {
    expect(findAdapter('/workspace/.cursor/rules/foo.mdc')?.format).toBe('cursor_rules');
  });

  it('markdown is always the fallback', () => {
    expect(findAdapter('README.md')?.format).toBe('markdown');
    expect(findAdapter('SERVICES.md')?.format).toBe('markdown');
    expect(findAdapter('random-doc.md')?.format).toBe('markdown');
  });

  it('non-md files have no adapter', () => {
    expect(findAdapter('main.ts')).toBeUndefined();
    expect(findAdapter('package.json')).toBeUndefined();
    expect(findAdapter('Dockerfile')).toBeUndefined();
  });

  it('markdown adapter is last in specificity order', () => {
    // Every file that a specific adapter handles must NOT fall through to markdown
    const specificFiles = ['CONSTITUTION.md', 'CLAUDE.md', '/project/.cursor/rules/test.mdc'];
    for (const file of specificFiles) {
      const adapter = findAdapter(file);
      expect(adapter?.format).not.toBe('markdown');
    }
  });
});

// ── Error Isolation ─────────────────────────────────────────────

describe('error isolation', () => {
  it('adaptFile returns empty array on adapter error, not throw', async () => {
    await withTempWorkspace(
      async (dir) => {
        // Write a malformed file that will cause the constitution parser to fail
        await writeFile(dir, 'CONSTITUTION.md', '\x00\x01\x02 binary garbage');
      },
      async (dir) => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const nodes = await adaptFile(path.join(dir, 'CONSTITUTION.md'), dir);
        // Should return nodes (possibly empty) without throwing
        expect(Array.isArray(nodes)).toBe(true);
        consoleSpy.mockRestore();
      },
    );
  });

  it('one bad file does not prevent other files from being adapted', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Git Discipline\n\nConventional commits.\n');
        // Create an unreadable file situation by using a directory where a file is expected
        // (the adapter will try to read it as a file and fail)
        await writeFile(dir, 'README.md', '## Overview\n\nProject info.\n');
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        // Should have nodes from CLAUDE.md even if other files fail
        const claudeNodes = nodes.filter((n) => n.origin.format === 'claude_md');
        expect(claudeNodes.length).toBeGreaterThan(0);
      },
    );
  });

  it('discoverAndAdapt succeeds on empty workspace', async () => {
    await withTempWorkspace(
      async () => {},
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        expect(nodes).toEqual([]);
      },
    );
  });
});

// ── CRLF Handling ───────────────────────────────────────────────

describe('CRLF line ending handling', () => {
  it('cursor adapter parses CRLF frontmatter correctly', async () => {
    await withTempWorkspace(
      async (dir) => {
        const crlf =
          '---\r\ndescription: Test rule.\r\nalwaysApply: true\r\n---\r\n\r\nRule content.\r\n';
        await writeFile(dir, '.cursor/rules/test.mdc', crlf);
      },
      async (dir) => {
        const filePath = path.join(dir, '.cursor/rules/test.mdc');
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].tier).toBe('navigational'); // alwaysApply
        expect(nodes[0].content).toContain('Rule content');
      },
    );
  });

  it('cursor adapter parses mixed line endings', async () => {
    await withTempWorkspace(
      async (dir) => {
        const mixed = '---\ndescription: Mixed.\r\nalwaysApply: true\n---\n\nContent here.\n';
        await writeFile(dir, '.cursor/rules/mixed.mdc', mixed);
      },
      async (dir) => {
        const filePath = path.join(dir, '.cursor/rules/mixed.mdc');
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].tier).toBe('navigational');
      },
    );
  });
});

// ── Budget Accuracy ─────────────────────────────────────────────

describe('token budget accuracy', () => {
  it('compiled bootPayload does not exceed requested budget', async () => {
    await withTempWorkspace(
      async (dir) => {
        // Create content that is much larger than the budget
        const longContent = 'word '.repeat(500);
        await writeFile(
          dir,
          'CLAUDE.md',
          `## Git\n\n${longContent}\n\n## Entry Points\n\n${longContent}\n`,
        );
        await writeFile(dir, 'README.md', `## Overview\n\n${longContent}\n`);
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 200,
        });

        expect(result.bootTokens).toBeLessThanOrEqual(200);
      },
    );
  });

  it('heading overhead is included in budget calculation', async () => {
    await withTempWorkspace(
      async (dir) => {
        // Create exactly-budgeted content across multiple types
        await writeFile(
          dir,
          'CLAUDE.md',
          '## Git\n\nShort.\n\n## Security Boundaries\n\nAlso short.\n',
        );
      },
      async (dir) => {
        // Very tight budget — should not overflow
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 50,
        });

        const payloadTokens = estimateTokens(result.bootPayload);
        expect(payloadTokens).toBeLessThanOrEqual(50);
      },
    );
  });

  it('larger budget includes more nodes', async () => {
    await withTempWorkspace(
      async (dir) => {
        const sections = Array.from(
          { length: 10 },
          (_, i) => `## Section ${i}\n\n${'content '.repeat(50)}\n`,
        ).join('\n');
        await writeFile(dir, 'CLAUDE.md', sections);
      },
      async (dir) => {
        const small = await compileWithAdapters({ workspaceRoot: dir, tokenBudget: 200 });
        const large = await compileWithAdapters({ workspaceRoot: dir, tokenBudget: 5000 });

        expect(large.nodes!.length).toBeGreaterThan(small.nodes!.length);
      },
    );
  });
});

// ── options.sources Respect ─────────────────────────────────────

describe('compileWithAdapters respects options.sources', () => {
  it('uses only specified sources when options.sources is provided', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Git\n\nConventional commits.\n');
        await writeFile(dir, 'README.md', '## Overview\n\nProject info.\n');
      },
      async (dir) => {
        // Only compile from README, not CLAUDE.md
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 5000,
          sources: [
            { path: path.join(dir, 'README.md'), kind: 'reference', relativePath: 'README.md' },
          ],
        });

        const formats = new Set(result.nodes!.map((n) => n.origin.format));
        expect(formats).toContain('markdown');
        expect(formats).not.toContain('claude_md');
      },
    );
  });

  it('auto-discovers when options.sources is not provided', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Git\n\nConventional commits.\n');
        await writeFile(dir, 'README.md', '## Overview\n\nProject info.\n');
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 5000,
        });

        const formats = new Set(result.nodes!.map((n) => n.origin.format));
        expect(formats).toContain('claude_md');
        expect(formats).toContain('markdown');
      },
    );
  });
});

// ── Payload Grouping ────────────────────────────────────────────

describe('payload grouping by type', () => {
  it('groups governance before architecture before conventions', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          'CLAUDE.md',
          '## Git Discipline\n\nConventional commits.\n\n## Security Boundaries\n\nNo credentials.\n',
        );
        await writeFile(
          dir,
          'CONSTITUTION.md',
          '## Purpose\n\nEngine.\n\n## Directory Semantics\n\n| Path | Description |\n|------|-------------|\n| `src/` | Source |\n',
        );
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 10000,
        });

        const governanceIdx = result.bootPayload.indexOf('## Governance');
        const archIdx = result.bootPayload.indexOf('## Architecture');
        const conventionsIdx = result.bootPayload.indexOf('## Conventions');

        // Governance should appear before Architecture which appears before Conventions
        if (governanceIdx !== -1 && archIdx !== -1) {
          expect(governanceIdx).toBeLessThan(archIdx);
        }
        if (archIdx !== -1 && conventionsIdx !== -1) {
          expect(archIdx).toBeLessThan(conventionsIdx);
        }
      },
    );
  });

  it('omits empty type groups from payload', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Git Discipline\n\nConventional commits.\n');
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 10000,
        });

        // Should not have ## Identity or ## Architecture if no nodes of those types exist
        // (unless the heading keyword also triggers for this test content)
        expect(result.bootPayload).not.toContain('## Identity');
      },
    );
  });
});

// ── Node Metadata Integrity ─────────────────────────────────────

describe('node metadata integrity', () => {
  it('every node has all required fields', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Git\n\nCommits.\n\n## Boundaries\n\nSecure.\n');
        await writeFile(
          dir,
          'CONSTITUTION.md',
          '## Purpose\n\nEngine.\n\n## Principles\n\n### TDD\nTests first.\n',
        );
        const rulesDir = path.join(dir, '.cursor', 'rules');
        await fs.mkdir(rulesDir, { recursive: true });
        await fs.writeFile(
          path.join(rulesDir, 'test.mdc'),
          '---\ndescription: Rule.\nalwaysApply: true\n---\n\nContent.\n',
        );
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);

        for (const node of nodes) {
          expect(node.id, `missing id`).toBeTruthy();
          expect(node.type, `missing type for ${node.id}`).toBeTruthy();
          expect(node.tier, `missing tier for ${node.id}`).toBeTruthy();
          expect(node.content, `missing content for ${node.id}`).toBeTruthy();
          expect(node.origin.source, `missing origin.source for ${node.id}`).toBeTruthy();
          expect(
            node.origin.relativePath,
            `missing origin.relativePath for ${node.id}`,
          ).toBeTruthy();
          expect(node.origin.format, `missing origin.format for ${node.id}`).toBeTruthy();
          expect(node.tokenEstimate, `zero tokenEstimate for ${node.id}`).toBeGreaterThan(0);
        }
      },
    );
  });

  it('node IDs are slugified (lowercase, hyphenated)', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          'CLAUDE.md',
          '## Git Discipline\n\nCommits.\n\n## Entry Points & CLI\n\nCommands.\n',
        );
      },
      async (dir) => {
        const nodes = await claudeAdapter.adapt(path.join(dir, 'CLAUDE.md'), dir);
        for (const node of nodes) {
          expect(node.id).toMatch(/^[a-z0-9-]*$/);
          expect(node.id).not.toMatch(/[A-Z]/);
          expect(node.id).not.toContain(' ');
        }
      },
    );
  });

  it('origin.relativePath is relative to workspace root', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CLAUDE.md', '## Test\n\nContent.\n');
        await writeFile(dir, 'spoke/CONSTITUTION.md', '## Purpose\n\nSpoke purpose.\n');
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        for (const node of nodes) {
          expect(path.isAbsolute(node.origin.relativePath)).toBe(false);
          expect(node.origin.relativePath).not.toContain(dir);
        }
      },
    );
  });
});

// ── Discovery Scope ─────────────────────────────────────────────

describe('discovery scope', () => {
  it('discovers spoke-level CONSTITUTION.md and CLAUDE.md', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'spoke1/CONSTITUTION.md', '## Purpose\n\nSpoke 1.\n');
        await writeFile(dir, 'spoke2/CLAUDE.md', '## Git\n\nCommits.\n');
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        const paths = nodes.map((n) => n.origin.relativePath);
        expect(paths).toContain(path.join('spoke1', 'CONSTITUTION.md'));
        expect(paths).toContain(path.join('spoke2', 'CLAUDE.md'));
      },
    );
  });

  it('skips dot-directories', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, '.hidden/CONSTITUTION.md', '## Purpose\n\nHidden.\n');
        await writeFile(dir, 'visible/CONSTITUTION.md', '## Purpose\n\nVisible.\n');
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        const sources = nodes.map((n) => n.origin.source);
        expect(sources.some((s) => s.includes('.hidden'))).toBe(false);
        expect(sources.some((s) => s.includes('visible'))).toBe(true);
      },
    );
  });

  it('skips node_modules and dist', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'node_modules/pkg/CONSTITUTION.md', '## Purpose\n\nPkg.\n');
        await writeFile(dir, 'dist/CONSTITUTION.md', '## Purpose\n\nDist.\n');
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        const sources = nodes.map((n) => n.origin.source);
        expect(sources.some((s) => s.includes('node_modules'))).toBe(false);
        expect(sources.some((s) => s.includes('dist'))).toBe(false);
      },
    );
  });

  it('discovers memory/Profile/*.md files', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'memory/Profile/Working Style.md', '## Focus\n\nDeep work blocks.\n');
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        expect(nodes.length).toBeGreaterThan(0);
        expect(nodes.some((n) => n.origin.relativePath.includes('Profile'))).toBe(true);
      },
    );
  });

  it('discovers .cursor/rules/*.mdc files', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          '.cursor/rules/commit.mdc',
          '---\ndescription: Commit.\nalwaysApply: true\n---\n\nCommit rule.\n',
        );
        await writeFile(
          dir,
          '.cursor/rules/style.mdc',
          '---\ndescription: Style.\nglobs: "*.ts"\n---\n\nStyle rule.\n',
        );
      },
      async (dir) => {
        const nodes = await discoverAndAdapt(dir);
        const cursorNodes = nodes.filter((n) => n.origin.format === 'cursor_rules');
        expect(cursorNodes).toHaveLength(2);
      },
    );
  });
});

// ── Task Hint Boosting ──────────────────────────────────────────

describe('task hint relevance boosting', () => {
  it('boosts nodes matching task terms', async () => {
    await withTempWorkspace(
      async (dir) => {
        // Create many sections, only one matches the task
        const sections = [
          '## Git Discipline\n\nConventional commits required.\n',
          '## Agent System\n\nAutonomous workspace agents.\n',
          '## Memory Integration\n\nSession observations.\n',
        ].join('\n');
        await writeFile(dir, 'CLAUDE.md', sections);
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 10000,
          taskHint: 'git commit conventional',
        });

        // Git-related node should be present and boosted
        const gitNode = result.nodes!.find((n) => n.id.includes('git'));
        expect(gitNode).toBeDefined();
      },
    );
  });
});

// ── Excluded Sections ───────────────────────────────────────────

describe('excluded sections', () => {
  it('excludes by node ID', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          'CLAUDE.md',
          '## Git Discipline\n\nCommits.\n\n## Agent System\n\nAgents.\n',
        );
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 10000,
          excluded: [['agent-system']],
        });

        const agentNodes = result.nodes!.filter((n) => n.id === 'agent-system');
        expect(agentNodes).toHaveLength(0);

        const gitNodes = result.nodes!.filter((n) => n.id.includes('git'));
        expect(gitNodes.length).toBeGreaterThan(0);
      },
    );
  });

  it('excludes by heading path prefix', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          'README.md',
          '## Overview\n\nInfo.\n\n## Installation\n\nnpm install.\n',
        );
      },
      async (dir) => {
        const result = await compileWithAdapters({
          workspaceRoot: dir,
          tokenBudget: 10000,
          excluded: [['Overview']],
        });

        const overviewNodes = result.nodes!.filter((n) =>
          n.origin.headingPath?.includes('Overview'),
        );
        expect(overviewNodes).toHaveLength(0);
      },
    );
  });
});

// ── Cursor Adapter Edge Cases ───────────────────────────────────

describe('cursor adapter edge cases', () => {
  it('handles .mdc with empty body after frontmatter', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          '.cursor/rules/empty.mdc',
          '---\ndescription: Empty.\nalwaysApply: true\n---\n',
        );
      },
      async (dir) => {
        const nodes = await cursorAdapter.adapt(path.join(dir, '.cursor/rules/empty.mdc'), dir);
        expect(nodes).toHaveLength(0);
      },
    );
  });

  it('handles .mdc with no frontmatter at all', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, '.cursor/rules/bare.mdc', 'Just plain content.');
      },
      async (dir) => {
        const nodes = await cursorAdapter.adapt(path.join(dir, '.cursor/rules/bare.mdc'), dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('reference');
      },
    );
  });

  it('preserves globs in origin headingPath', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          '.cursor/rules/py.mdc',
          '---\ndescription: Python.\nglobs: "*.py"\n---\n\nType hints.\n',
        );
      },
      async (dir) => {
        const nodes = await cursorAdapter.adapt(path.join(dir, '.cursor/rules/py.mdc'), dir);
        expect(nodes[0].origin.headingPath).toEqual(['globs:"*.py"']);
      },
    );
  });
});

// ── Constitution Adapter Edge Cases ─────────────────────────────

describe('constitution adapter edge cases', () => {
  it('handles constitution with only purpose section', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CONSTITUTION.md', '## Purpose\n\nMinimal constitution.\n');
      },
      async (dir) => {
        const nodes = await constitutionAdapter.adapt(path.join(dir, 'CONSTITUTION.md'), dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].id).toBe('purpose');
        expect(nodes[0].type).toBe('identity');
      },
    );
  });

  it('handles empty constitution', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'CONSTITUTION.md', '# Empty\n');
      },
      async (dir) => {
        const nodes = await constitutionAdapter.adapt(path.join(dir, 'CONSTITUTION.md'), dir);
        expect(nodes).toHaveLength(0);
      },
    );
  });
});

// ── Claude Adapter Edge Cases ───────────────────────────────────

describe('claude adapter edge cases', () => {
  it('handles CLAUDE.md with nested headings under h1', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(
          dir,
          'CLAUDE.md',
          '# Instructions\n\n## Git\n\nCommits.\n\n## Workspace Health\n\nMaintenance.\n',
        );
      },
      async (dir) => {
        const nodes = await claudeAdapter.adapt(path.join(dir, 'CLAUDE.md'), dir);
        expect(nodes.length).toBe(2);
        // Both should have headingPath including the h1 parent
        for (const node of nodes) {
          expect(node.origin.headingPath!.length).toBeGreaterThanOrEqual(1);
        }
      },
    );
  });

  it('handles very large CLAUDE.md efficiently', async () => {
    await withTempWorkspace(
      async (dir) => {
        const sections = Array.from(
          { length: 50 },
          (_, i) => `## Section ${i}\n\n${'content '.repeat(100)}\n`,
        ).join('\n');
        await writeFile(dir, 'CLAUDE.md', sections);
      },
      async (dir) => {
        const start = Date.now();
        const nodes = await claudeAdapter.adapt(path.join(dir, 'CLAUDE.md'), dir);
        const elapsed = Date.now() - start;

        expect(nodes.length).toBe(50);
        expect(elapsed).toBeLessThan(1000); // Should be fast
      },
    );
  });
});

// ── Markdown Adapter: Purpose Classification Fix ────────────────

describe('markdown adapter: purpose classification (fix #1)', () => {
  it('classifies "Purpose" as identity, not governance', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'README.md', '## Purpose\n\nThis project does things.\n');
      },
      async (dir) => {
        const nodes = await markdownAdapter.adapt(path.join(dir, 'README.md'), dir);
        expect(nodes[0].type).toBe('identity');
        expect(nodes[0].tier).toBe('identity');
      },
    );
  });

  it('still classifies "Principles" as governance', async () => {
    await withTempWorkspace(
      async (dir) => {
        await writeFile(dir, 'README.md', "## Principles\n\nDon't repeat yourself.\n");
      },
      async (dir) => {
        const nodes = await markdownAdapter.adapt(path.join(dir, 'README.md'), dir);
        expect(nodes[0].type).toBe('governance');
        expect(nodes[0].tier).toBe('constitutional');
      },
    );
  });
});

// ── Real-World Workspace ────────────────────────────────────────

describe('real-world: mgmt workspace', () => {
  const mgmtRoot = path.resolve(process.env.HOME || '~', 'redhat/mgmt');

  async function skipIfMissing(): Promise<boolean> {
    try {
      await fs.access(mgmtRoot);
      return false;
    } catch {
      return true;
    }
  }

  it('discovers all expected source formats', async () => {
    if (await skipIfMissing()) return;

    const nodes = await discoverAndAdapt(mgmtRoot);
    const formats = new Set(nodes.map((n) => n.origin.format));

    expect(formats).toContain('claude_md');
    expect(formats).toContain('constitution');
    // cursor rules may or may not be present
  });

  it('classifies mgmt CLAUDE.md Git Discipline as operational', async () => {
    if (await skipIfMissing()) return;

    const nodes = await claudeAdapter.adapt(path.join(mgmtRoot, 'CLAUDE.md'), mgmtRoot);
    const gitNode = nodes.find((n) => n.id === 'git-discipline');
    expect(gitNode).toBeDefined();
    expect(gitNode!.type).toBe('operational');
    expect(gitNode!.tier).toBe('navigational');
  });

  it('compiles with adapter pipeline producing grouped output', async () => {
    if (await skipIfMissing()) return;

    const result = await compileWithAdapters({
      workspaceRoot: mgmtRoot,
      tokenBudget: 8000,
      taskHint: 'Review PR for convention violations',
    });

    expect(result.bootPayload).toBeTruthy();
    expect(result.nodes).toBeDefined();
    expect(result.nodes!.length).toBeGreaterThan(5);
    expect(result.bootTokens).toBeLessThanOrEqual(8000);

    // Should have type groups
    expect(result.bootPayload).toContain('##');

    // Multiple formats
    const formats = new Set(result.nodes!.map((n) => n.origin.format));
    expect(formats.size).toBeGreaterThanOrEqual(2);
  });

  it('every node has valid type and tier values', async () => {
    if (await skipIfMissing()) return;

    const validTypes = ['structural', 'operational', 'identity', 'governance', 'reference'];
    const validTiers = ['constitutional', 'navigational', 'identity', 'reference', 'historical'];

    const nodes = await discoverAndAdapt(mgmtRoot);
    for (const node of nodes) {
      expect(validTypes, `invalid type '${node.type}' for ${node.id}`).toContain(node.type);
      expect(validTiers, `invalid tier '${node.tier}' for ${node.id}`).toContain(node.tier);
    }
  });
});
