import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { rhythmsAdapter } from '../../src/adapter/rhythms.js';

async function withTempFile(
  filename: string,
  content: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const contextDir = path.join(dir, 'context');
  await fs.mkdir(contextDir, { recursive: true });
  const filePath = path.join(contextDir, filename);
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('rhythmsAdapter', () => {
  it('has format "rhythms"', () => {
    expect(rhythmsAdapter.format).toBe('rhythms');
  });

  describe('canHandle', () => {
    it('handles context/rhythms.yaml', () => {
      expect(rhythmsAdapter.canHandle('context/rhythms.yaml')).toBe(true);
      expect(rhythmsAdapter.canHandle('/path/to/context/rhythms.yaml')).toBe(true);
    });

    it('handles context/cadence.yaml', () => {
      expect(rhythmsAdapter.canHandle('context/cadence.yaml')).toBe(true);
      expect(rhythmsAdapter.canHandle('/path/to/context/cadence.yaml')).toBe(true);
    });

    it('rejects other files', () => {
      expect(rhythmsAdapter.canHandle('rhythms.yaml')).toBe(false);
      expect(rhythmsAdapter.canHandle('context/other.yaml')).toBe(false);
      expect(rhythmsAdapter.canHandle('KNOWLEDGE.md')).toBe(false);
      expect(rhythmsAdapter.canHandle('context/rhythms.md')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts cadences from rhythms.yaml with nested periods', async () => {
      const yaml = `
daily:
  - standup: "09:15 — team sync, blockers, priorities"
  - email_triage: "morning — classify and action inbox"

weekly:
  - team_review: "Monday — review sprint progress"
  - 1on1s: "Wednesday/Thursday — direct report check-ins"

monthly:
  - retrospective: "first Friday — team retro"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(3); // one per period: daily, weekly, monthly

        // All nodes should be operational type and tier
        for (const node of nodes) {
          expect(node.type).toBe('operational');
          expect(node.tier).toBe('operational');
          expect(node.origin.format).toBe('rhythms');
        }
      });
    });

    it('assigns correct IDs with rhythms prefix', async () => {
      const yaml = `
daily:
  - standup: "09:15 — sync"
quarterly:
  - okr_review: "review objectives"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(2);
        expect(nodes[0].id).toBe('rhythms-daily');
        expect(nodes[1].id).toBe('rhythms-quarterly');
      });
    });

    it('sets correct origin with relative path and heading path', async () => {
      const yaml = `
weekly:
  - planning: "Monday — sprint planning"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].origin.source).toBe(filePath);
        expect(nodes[0].origin.relativePath).toBe('context/rhythms.yaml');
        expect(nodes[0].origin.headingPath).toEqual(['weekly']);
      });
    });

    it('formats activities as readable content', async () => {
      const yaml = `
daily:
  - standup: "09:15 — team sync"
  - email_triage: "morning — classify inbox"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].content).toContain('standup');
        expect(nodes[0].content).toContain('09:15');
        expect(nodes[0].content).toContain('email_triage');
      });
    });

    it('estimates tokens for each node', async () => {
      const yaml = `
daily:
  - standup: "09:15 — team sync"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].tokenEstimate).toBeGreaterThan(0);
      });
    });

    it('returns empty array for empty YAML', async () => {
      await withTempFile('rhythms.yaml', '', async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('returns empty array for YAML with no top-level keys', async () => {
      const yaml = `# just a comment\n`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('works with cadence.yaml filename', async () => {
      const yaml = `
daily:
  - standup: "09:15 — sync"
`;
      await withTempFile('cadence.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].origin.relativePath).toBe('context/cadence.yaml');
      });
    });

    it('handles string list items (no key-value)', async () => {
      const yaml = `
daily:
  - "standup at 09:15"
  - "email triage"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].content).toContain('standup at 09:15');
        expect(nodes[0].content).toContain('email triage');
      });
    });

    it('handles nested object activities with description field', async () => {
      const yaml = `
weekly:
  - name: team_review
    time: "Monday 10:00"
    description: "Review sprint progress and blockers"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].content).toContain('team_review');
        expect(nodes[0].content).toContain('Monday 10:00');
      });
    });

    it('preserves period ordering from YAML', async () => {
      const yaml = `
quarterly:
  - okr_review: "review objectives"
daily:
  - standup: "09:15 — sync"
monthly:
  - retro: "team retrospective"
`;
      await withTempFile('rhythms.yaml', yaml, async (filePath, dir) => {
        const nodes = await rhythmsAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(3);
        expect(nodes[0].id).toBe('rhythms-quarterly');
        expect(nodes[1].id).toBe('rhythms-daily');
        expect(nodes[2].id).toBe('rhythms-monthly');
      });
    });
  });
});
