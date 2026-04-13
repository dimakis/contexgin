import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { cursorAdapter } from '../../src/adapter/cursor.js';

async function withMdcFile(
  content: string,
  filename: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const rulesDir = path.join(dir, '.cursor', 'rules');
  await fs.mkdir(rulesDir, { recursive: true });
  const filePath = path.join(rulesDir, filename);
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('cursorAdapter', () => {
  it('has format "cursor_rules"', () => {
    expect(cursorAdapter.format).toBe('cursor_rules');
  });

  describe('canHandle', () => {
    it('handles .mdc files in .cursor/rules/', () => {
      expect(cursorAdapter.canHandle('/project/.cursor/rules/foo.mdc')).toBe(true);
    });

    it('rejects .mdc files outside .cursor/rules/', () => {
      expect(cursorAdapter.canHandle('/project/foo.mdc')).toBe(false);
    });

    it('rejects non-.mdc files', () => {
      expect(cursorAdapter.canHandle('/project/.cursor/rules/foo.md')).toBe(false);
    });
  });

  describe('frontmatter parsing', () => {
    it('parses alwaysApply + description', async () => {
      const mdc = `---
description: Conventional commit format.
alwaysApply: true
---

# Conventional Commits

All commits MUST use this format.
`;
      await withMdcFile(mdc, 'conventional-commit.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].id).toBe('conventional-commit');
      });
    });

    it('parses globs from frontmatter', async () => {
      const mdc = `---
description: Python-specific rules.
globs: "*.py"
---

Use type hints everywhere.
`;
      await withMdcFile(mdc, 'python-rules.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.headingPath).toEqual(['globs:"*.py"']);
      });
    });

    it('handles file without frontmatter', async () => {
      const mdc = `# Simple Rule

Do this thing.
`;
      await withMdcFile(mdc, 'simple.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('reference');
      });
    });
  });

  describe('classification', () => {
    it('alwaysApply + governance keywords → governance/constitutional', async () => {
      const mdc = `---
description: Confidentiality boundaries for workspace.
alwaysApply: true
---

Never expose career spoke content in shared contexts.
`;
      await withMdcFile(mdc, 'boundaries.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('governance');
        expect(nodes[0].tier).toBe('constitutional');
      });
    });

    it('alwaysApply + commit keyword → operational/navigational', async () => {
      const mdc = `---
description: Commit checkpoint rule.
alwaysApply: true
---

After each logical unit of work, commit.
`;
      await withMdcFile(mdc, 'commit-checkpoint.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('alwaysApply without specific keywords → operational/navigational', async () => {
      const mdc = `---
description: Boot context for all sessions.
alwaysApply: true
---

Load workspace identity at session start.
`;
      await withMdcFile(mdc, 'boot-context.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('globs-scoped rule → operational/navigational', async () => {
      const mdc = `---
description: TypeScript-specific rules.
globs: "*.ts"
---

Use strict mode.
`;
      await withMdcFile(mdc, 'typescript.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('no frontmatter → operational/reference', async () => {
      const mdc = `Some miscellaneous guidance.`;
      await withMdcFile(mdc, 'misc.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('reference');
      });
    });
  });

  describe('output structure', () => {
    it('sets origin format to cursor_rules', async () => {
      const mdc = `---
description: Test rule.
alwaysApply: true
---

Content here.
`;
      await withMdcFile(mdc, 'test.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.format).toBe('cursor_rules');
        expect(nodes[0].origin.relativePath).toBe('.cursor/rules/test.mdc');
      });
    });

    it('returns empty array for empty body', async () => {
      const mdc = `---
description: Empty rule.
alwaysApply: true
---
`;
      await withMdcFile(mdc, 'empty.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('estimates tokens correctly', async () => {
      const mdc = `---
description: Token test.
---

${'word '.repeat(200)}
`;
      await withMdcFile(mdc, 'long.mdc', async (filePath, dir) => {
        const nodes = await cursorAdapter.adapt(filePath, dir);
        expect(nodes[0].tokenEstimate).toBeGreaterThan(100);
      });
    });
  });

  describe('real-world: mgmt cursor rules', () => {
    const mgmtRulesDir = path.resolve(process.env.HOME || '~', 'redhat/mgmt/.cursor/rules');

    it('parses all mgmt .mdc files without errors', async () => {
      try {
        await fs.access(mgmtRulesDir);
      } catch {
        return; // Skip if dir doesn't exist (CI)
      }

      const files = await fs.readdir(mgmtRulesDir);
      const mdcFiles = files.filter((f) => f.endsWith('.mdc'));
      expect(mdcFiles.length).toBeGreaterThan(0);

      const workspaceRoot = path.resolve(process.env.HOME || '~', 'redhat/mgmt');

      for (const file of mdcFiles) {
        const filePath = path.join(mgmtRulesDir, file);
        const nodes = await cursorAdapter.adapt(filePath, workspaceRoot);
        for (const node of nodes) {
          expect(node.id).toBeTruthy();
          expect(node.origin.format).toBe('cursor_rules');
          expect(node.tokenEstimate).toBeGreaterThan(0);
        }
      }
    });
  });
});
