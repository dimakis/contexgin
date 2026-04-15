import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { constitutionAdapter } from '../../src/adapter/constitution.js';

async function withTempFile(
  content: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const filePath = path.join(dir, 'CONSTITUTION.md');
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('constitutionAdapter', () => {
  it('has format "constitution"', () => {
    expect(constitutionAdapter.format).toBe('constitution');
  });

  describe('canHandle', () => {
    it('handles CONSTITUTION.md', () => {
      expect(constitutionAdapter.canHandle('CONSTITUTION.md')).toBe(true);
      expect(constitutionAdapter.canHandle('/path/to/CONSTITUTION.md')).toBe(true);
    });

    it('rejects other files', () => {
      expect(constitutionAdapter.canHandle('README.md')).toBe(false);
      expect(constitutionAdapter.canHandle('CLAUDE.md')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts purpose as identity/constitutional', async () => {
      const md = `# My Project

## Purpose

Context orchestration engine for AI agents.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        const purpose = nodes.find((n) => n.id === 'purpose');
        expect(purpose).toBeDefined();
        expect(purpose!.type).toBe('identity');
        expect(purpose!.tier).toBe('constitutional');
        expect(purpose!.content).toContain('Context orchestration');
      });
    });

    it('extracts directory tree as structural/navigational', async () => {
      const md = `## Directory Semantics

| Path | Description |
|------|-------------|
| \`src/\` | All source code |
| \`tests/\` | Test files |
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        const tree = nodes.find((n) => n.id === 'directory-semantics');
        expect(tree).toBeDefined();
        expect(tree!.type).toBe('structural');
        expect(tree!.tier).toBe('navigational');
        expect(tree!.content).toContain('src/');
        expect(tree!.content).toContain('tests/');
      });
    });

    it('extracts entry points as operational/navigational', async () => {
      const md = `## Entry Points

| Command | Description |
|---------|-------------|
| \`npm test\` | Run tests |
| \`npm run build\` | Build project |
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        const ep = nodes.find((n) => n.id === 'entry-points');
        expect(ep).toBeDefined();
        expect(ep!.type).toBe('operational');
        expect(ep!.tier).toBe('navigational');
        expect(ep!.content).toContain('npm test');
      });
    });

    it('extracts boundaries as governance/constitutional', async () => {
      const md = `## Boundaries

- Never expose credentials
- Hard confidential: career spoke
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        const boundaries = nodes.find((n) => n.id === 'boundaries');
        expect(boundaries).toBeDefined();
        expect(boundaries!.type).toBe('governance');
        expect(boundaries!.tier).toBe('constitutional');
      });
    });

    it('extracts principles as governance/constitutional', async () => {
      const md = `## Principles

### Separation of Concerns
Each thing does one thing.

### Hub-and-Spoke
Everything connects through hubs.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        const principles = nodes.find((n) => n.id === 'principles');
        expect(principles).toBeDefined();
        expect(principles!.type).toBe('governance');
        expect(principles!.tier).toBe('constitutional');
        expect(principles!.content).toContain('Separation of Concerns');
      });
    });

    it('sets correct origin metadata', async () => {
      const md = `## Purpose

Test purpose.
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.format).toBe('constitution');
        expect(nodes[0].origin.relativePath).toBe('CONSTITUTION.md');
        expect(nodes[0].origin.headingPath).toEqual(['Purpose']);
      });
    });

    it('skips empty sections', async () => {
      const md = `# Empty Constitution
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('handles full constitution with all sections', async () => {
      const md = `# ContexGin

## Purpose

Context orchestration engine.

## Directory Semantics

| Path | Description |
|------|-------------|
| \`src/\` | Source code |

## Entry Points

| Command | Description |
|---------|-------------|
| \`npm test\` | Run tests |

## Principles

### TDD
Tests first.

## Boundaries

- Hard confidential: never surface career data
`;
      await withTempFile(md, async (filePath, dir) => {
        const nodes = await constitutionAdapter.adapt(filePath, dir);
        const types = nodes.map((n) => n.id);
        expect(types).toContain('purpose');
        expect(types).toContain('directory-semantics');
        expect(types).toContain('entry-points');
        expect(types).toContain('principles');
        expect(types).toContain('boundaries');
      });
    });
  });

  describe('real-world: mgmt CONSTITUTION.md', () => {
    const mgmtConst = path.resolve(process.env.HOME || '~', 'redhat/mgmt/CONSTITUTION.md');

    it('parses mgmt CONSTITUTION.md without errors', async () => {
      try {
        await fs.access(mgmtConst);
      } catch {
        return;
      }

      const nodes = await constitutionAdapter.adapt(mgmtConst, path.dirname(mgmtConst));
      expect(nodes.length).toBeGreaterThan(0);

      for (const node of nodes) {
        expect(node.id).toBeTruthy();
        expect(node.origin.format).toBe('constitution');
        expect(node.tokenEstimate).toBeGreaterThan(0);
      }
    });
  });
});
