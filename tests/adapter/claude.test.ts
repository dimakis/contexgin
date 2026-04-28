import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { claudeAdapter } from '../../src/adapter/claude.js';

async function withTempFile(
  content: string,
  filename: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('claudeAdapter', () => {
  it('has format "claude_md"', () => {
    expect(claudeAdapter.format).toBe('claude_md');
  });

  describe('canHandle', () => {
    it('handles CLAUDE.md', () => {
      expect(claudeAdapter.canHandle('CLAUDE.md')).toBe(true);
      expect(claudeAdapter.canHandle('/path/to/CLAUDE.md')).toBe(true);
    });

    it('rejects other .md files', () => {
      expect(claudeAdapter.canHandle('README.md')).toBe(false);
      expect(claudeAdapter.canHandle('CLAUDE_NOTES.md')).toBe(false);
    });
  });

  describe('classification', () => {
    it('classifies Git Discipline as operational/navigational', async () => {
      const md = `## Git Discipline

### Conventional Commits
All commits use: \`<type>(scope): description\`
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
        expect(nodes[0].id).toBe('git-discipline');
      });
    });

    it('classifies Entry Points as operational/navigational', async () => {
      const md = `## Entry Points

| Command | Description |
|---------|-------------|
| \`./mgmt\` | Interactive CLI |
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('classifies Boundary sections as governance/constitutional', async () => {
      const md = `## Confidentiality Boundaries

Career spoke is hard-confidential. Never surface in shared contexts.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('governance');
        expect(nodes[0].tier).toBe('constitutional');
      });
    });

    it('classifies Architecture as structural/navigational', async () => {
      const md = `## Architecture

Hub-spoke topology with mgmt as root hub.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('structural');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('classifies Agent System as operational/navigational', async () => {
      const md = `## Agent System

Autonomous workspace agents with journals and proposals.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('classifies Jira Context as operational/reference', async () => {
      const md = `## Jira Context

Read workflow.md and org_structure.md for custom fields.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('reference');
      });
    });

    it('classifies Worktree Sessions as operational/navigational', async () => {
      const md = `## Worktree Sessions

Sessions use multi-repo worktrees.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
      });
    });
  });

  describe('output structure', () => {
    it('sets origin format to claude_md', async () => {
      const md = `## Boot Context

Identity and workspace architecture.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.format).toBe('claude_md');
        expect(nodes[0].origin.relativePath).toBe('CLAUDE.md');
      });
    });

    it('extracts multiple sections', async () => {
      const md = `# Claude Code Instructions

## Git Discipline

Conventional commits required.

## Entry Points

\`./mgmt\` is the primary interface.

## Security Boundaries

Never expose credentials.
`;
      await withTempFile(md, 'CLAUDE.md', async (filePath, dir) => {
        const nodes = await claudeAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(3);
        expect(nodes[0].id).toBe('git-discipline');
        expect(nodes[1].id).toBe('entry-points');
        expect(nodes[2].id).toBe('security-boundaries');
      });
    });
  });

  describe('real-world: mgmt CLAUDE.md', () => {
    const mgmtClaude = path.resolve(process.env.HOME || '~', 'redhat/mgmt/CLAUDE.md');

    it('parses mgmt CLAUDE.md without errors', async () => {
      try {
        await fs.access(mgmtClaude);
      } catch {
        return; // Skip if file doesn't exist (CI)
      }

      const nodes = await claudeAdapter.adapt(mgmtClaude, path.dirname(mgmtClaude));
      expect(nodes.length).toBeGreaterThan(5);

      // Every node should have required fields
      for (const node of nodes) {
        expect(node.id).toBeTruthy();
        expect(node.type).toBeTruthy();
        expect(node.tier).toBeTruthy();
        expect(node.content).toBeTruthy();
        expect(node.origin.format).toBe('claude_md');
        expect(node.tokenEstimate).toBeGreaterThan(0);
      }
    });

    it('classifies Git Discipline correctly from real file', async () => {
      try {
        await fs.access(mgmtClaude);
      } catch {
        return;
      }

      const nodes = await claudeAdapter.adapt(mgmtClaude, path.dirname(mgmtClaude));
      const gitNode = nodes.find((n) => n.id === 'git-discipline');
      expect(gitNode).toBeDefined();
      expect(gitNode!.type).toBe('operational');
      expect(gitNode!.tier).toBe('navigational');
    });
  });
});
