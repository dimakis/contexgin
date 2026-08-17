import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { knowledgeAdapter } from '../../src/adapter/knowledge.js';

async function withTempFile(
  content: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const filePath = path.join(dir, 'KNOWLEDGE.md');
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('knowledgeAdapter', () => {
  it('has format "knowledge"', () => {
    expect(knowledgeAdapter.format).toBe('knowledge');
  });

  describe('canHandle', () => {
    it('handles KNOWLEDGE.md', () => {
      expect(knowledgeAdapter.canHandle('KNOWLEDGE.md')).toBe(true);
      expect(knowledgeAdapter.canHandle('/path/to/KNOWLEDGE.md')).toBe(true);
    });

    it('rejects other files', () => {
      expect(knowledgeAdapter.canHandle('README.md')).toBe(false);
      expect(knowledgeAdapter.canHandle('CLAUDE.md')).toBe(false);
      expect(knowledgeAdapter.canHandle('CONSTITUTION.md')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('assigns operational type and tier to all nodes', async () => {
      const md = `# Knowledge Store

## Primitives

Constitution, State Machine, Reference Dictionary.

## Maintenance

Run health checks weekly.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await knowledgeAdapter.adapt(filePath, dir);
        expect(nodes.length).toBeGreaterThan(0);

        for (const node of nodes) {
          expect(node.type).toBe('operational');
          expect(node.tier).toBe('operational');
        }
      });
    });

    it('sets correct origin format', async () => {
      const md = `## Overview

Knowledge store operating manual.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await knowledgeAdapter.adapt(filePath, dir);
        expect(nodes.length).toBeGreaterThan(0);

        for (const node of nodes) {
          expect(node.origin.format).toBe('knowledge');
          expect(node.origin.relativePath).toBe('KNOWLEDGE.md');
        }
      });
    });

    it('sets heading path in origin', async () => {
      const md = `## Primitives

The 13 primitives.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await knowledgeAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].origin.headingPath).toEqual(['Primitives']);
      });
    });

    it('returns empty array for empty content', async () => {
      const md = `# Knowledge Store
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await knowledgeAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('generates slugified IDs with knowledge prefix', async () => {
      const md = `## Spoke Health

Monitor spoke health scores.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await knowledgeAdapter.adapt(filePath, dir);
        expect(nodes[0].id).toBe('knowledge-spoke-health');
      });
    });

    it('estimates tokens for each node', async () => {
      const md = `## Primitives

Constitution, State Machine, Reference Dictionary, Org Topology.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await knowledgeAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].tokenEstimate).toBeGreaterThan(0);
      });
    });
  });
});
