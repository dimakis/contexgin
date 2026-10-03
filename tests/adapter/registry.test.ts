import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { findAdapter, adaptFile } from '../../src/adapter/registry.js';
import { discoverAndAdapt } from '../../src/adapter/index.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

describe('findAdapter', () => {
  it('selects constitution adapter for CONSTITUTION.md', () => {
    const adapter = findAdapter('/workspace/CONSTITUTION.md');
    expect(adapter?.format).toBe('constitution');
  });

  it('selects claude adapter for CLAUDE.md', () => {
    const adapter = findAdapter('/workspace/CLAUDE.md');
    expect(adapter?.format).toBe('claude_md');
  });

  it('selects cursor adapter for .cursor/rules/*.mdc', () => {
    const adapter = findAdapter('/workspace/.cursor/rules/foo.mdc');
    expect(adapter?.format).toBe('cursor_rules');
  });

  it('selects markdown adapter for README.md', () => {
    const adapter = findAdapter('/workspace/README.md');
    expect(adapter?.format).toBe('markdown');
  });

  it('selects markdown adapter for SERVICES.md', () => {
    const adapter = findAdapter('/workspace/SERVICES.md');
    expect(adapter?.format).toBe('markdown');
  });

  it('selects knowledge adapter for KNOWLEDGE.md', () => {
    const adapter = findAdapter('/workspace/KNOWLEDGE.md');
    expect(adapter?.format).toBe('knowledge');
  });

  it('prefers constitution over markdown for CONSTITUTION.md', () => {
    const adapter = findAdapter('CONSTITUTION.md');
    expect(adapter?.format).toBe('constitution');
  });

  it('prefers claude over markdown for CLAUDE.md', () => {
    const adapter = findAdapter('CLAUDE.md');
    expect(adapter?.format).toBe('claude_md');
  });

  it('selects workflow adapter for workflows/*.yaml', () => {
    const adapter = findAdapter('/workspace/workflows/release.yaml');
    expect(adapter?.format).toBe('workflow');
  });

  it('returns undefined for non-handled files', () => {
    expect(findAdapter('foo.ts')).toBeUndefined();
    expect(findAdapter('foo.py')).toBeUndefined();
  });
});

describe('adaptFile', () => {
  it('returns empty array for unhandled file types', async () => {
    const nodes = await adaptFile('/workspace/foo.ts', '/workspace');
    expect(nodes).toEqual([]);
  });
});

describe('discoverAndAdapt', () => {
  async function createWorkspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));

    // Root files
    await fs.writeFile(
      path.join(dir, 'CLAUDE.md'),
      '## Git Discipline\n\nConventional commits.\n\n## Entry Points\n\n`./start`\n',
    );
    await fs.writeFile(path.join(dir, 'README.md'), '## Overview\n\nA project.\n');

    // Cursor rules
    const rulesDir = path.join(dir, '.cursor', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(
      path.join(rulesDir, 'commit.mdc'),
      '---\ndescription: Commit rules.\nalwaysApply: true\n---\n\nUse conventional commits.\n',
    );

    // Spoke with constitution
    const spoke = path.join(dir, 'command_center');
    await fs.mkdir(spoke);
    await fs.writeFile(
      path.join(spoke, 'CONSTITUTION.md'),
      '## Purpose\n\nBriefing and reporting engine.\n',
    );

    return dir;
  }

  it('discovers all context sources in a workspace', async () => {
    const dir = await createWorkspace();
    try {
      const nodes = await discoverAndAdapt(dir);

      // Should have nodes from: CLAUDE.md, README.md, commit.mdc, spoke CONSTITUTION.md
      expect(nodes.length).toBeGreaterThanOrEqual(4);

      const formats = new Set(nodes.map((n) => n.origin.format));
      expect(formats).toContain('claude_md');
      expect(formats).toContain('markdown');
      expect(formats).toContain('cursor_rules');
      expect(formats).toContain('constitution');
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('skips dot-directories and node_modules', async () => {
    const dir = await createWorkspace();
    try {
      // Add a .hidden directory with a constitution
      const hidden = path.join(dir, '.hidden');
      await fs.mkdir(hidden);
      await fs.writeFile(path.join(hidden, 'CONSTITUTION.md'), '## Purpose\n\nHidden.\n');

      const nodes = await discoverAndAdapt(dir);
      const hiddenNodes = nodes.filter((n) => n.origin.source.includes('.hidden'));
      expect(hiddenNodes).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  describe('real-world: mgmt workspace', () => {
    const mgmtRoot = path.resolve(process.env.HOME || '~', 'redhat/mgmt');

    it('discovers mgmt workspace sources without errors', async () => {
      try {
        await fs.access(mgmtRoot);
      } catch {
        return;
      }

      const nodes = await discoverAndAdapt(mgmtRoot);
      expect(nodes.length).toBeGreaterThan(5);

      const formats = new Set(nodes.map((n) => n.origin.format));
      const hasCanonical = await fs.access(path.join(mgmtRoot, 'AGENTS.md')).then(
        () => true,
        () => false,
      );
      expect(formats).toContain(hasCanonical ? 'agents_md' : 'claude_md');
      expect(formats).toContain('constitution');

      // All nodes should be valid
      for (const node of nodes) {
        expect(node.id).toBeTruthy();
        expect(node.type).toBeTruthy();
        expect(node.tier).toBeTruthy();
        expect(node.tokenEstimate).toBeGreaterThan(0);
      }
    });
  });
});

it('discovers workflows deterministically despite filesystem ordering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-workflow-order-'));
  const dir = path.join(root, 'workflows');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'z.yaml'), 'name: Z');
  await fs.writeFile(path.join(dir, 'a.yaml'), 'name: A');
  const original = fs.readdir;
  const spy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
    if (String(args[0]) === dir) return ['z.yaml', 'a.yaml'] as never;
    return original(...args);
  });
  try {
    const nodes = await discoverAndAdapt(root);
    expect(
      nodes.filter((node) => node.origin.format === 'workflow').map((node) => node.id),
    ).toEqual(['workflow-a-overview', 'workflow-z-overview']);
  } finally {
    spy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
