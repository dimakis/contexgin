import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { markdownAdapter } from '../../src/adapter/markdown.js';

async function withTempFile(
  content: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const filePath = path.join(dir, 'test.md');
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('markdownAdapter', () => {
  it('has format "markdown"', () => {
    expect(markdownAdapter.format).toBe('markdown');
  });

  describe('canHandle', () => {
    it('handles .md files', () => {
      expect(markdownAdapter.canHandle('README.md')).toBe(true);
      expect(markdownAdapter.canHandle('/path/to/SERVICES.md')).toBe(true);
    });

    it('rejects non-md files', () => {
      expect(markdownAdapter.canHandle('foo.ts')).toBe(false);
      expect(markdownAdapter.canHandle('foo.mdc')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts h2 sections as context nodes', async () => {
      const md = `# Project

## Architecture

Hub-spoke model with clear boundaries.

## Entry Points

Run \`./start\` to begin.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(2);
        expect(nodes[0].id).toBe('architecture');
        expect(nodes[1].id).toBe('entry-points');
      });
    });

    it('classifies governance headings correctly', async () => {
      const md = `## Principles

Never break the build.

## Boundaries

No cross-spoke access.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('governance');
        expect(nodes[0].tier).toBe('constitutional');
        expect(nodes[1].type).toBe('governance');
        expect(nodes[1].tier).toBe('constitutional');
      });
    });

    it('classifies navigational headings correctly', async () => {
      const md = `## Directory Structure

src/ contains all source code.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('structural');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('classifies historical headings correctly', async () => {
      const md = `## Session Notes

We decided to use TypeScript.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('reference');
        expect(nodes[0].tier).toBe('historical');
      });
    });

    it('defaults to reference for unknown headings', async () => {
      const md = `## Miscellaneous

Random stuff here.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('reference');
        expect(nodes[0].tier).toBe('reference');
      });
    });

    it('sets correct origin metadata', async () => {
      const md = `## Overview

Some content.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.source).toBe(filePath);
        expect(nodes[0].origin.relativePath).toBe('test.md');
        expect(nodes[0].origin.format).toBe('markdown');
        expect(nodes[0].origin.headingPath).toEqual(['Overview']);
      });
    });

    it('estimates tokens for each node', async () => {
      const md = `## Short

Hi.

## Long

${'word '.repeat(100)}
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes[0].tokenEstimate).toBeLessThan(nodes[1].tokenEstimate);
        expect(nodes[0].tokenEstimate).toBeGreaterThan(0);
      });
    });

    it('strips frontmatter before parsing', async () => {
      const md = `---
title: Test
---

## Content

Actual content here.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].id).toBe('content');
        expect(nodes[0].content).not.toContain('title: Test');
      });
    });

    it('handles empty file gracefully', async () => {
      await withTempFile('', async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('handles file with no h2 sections', async () => {
      const md = `# Only H1

Some content without h2 sections.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await markdownAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });
  });
});
