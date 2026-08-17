import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { entityAdapter } from '../../src/adapter/entity.js';

async function withTempFile(
  content: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const contextDir = path.join(dir, 'context');
  await fs.mkdir(contextDir, { recursive: true });
  const filePath = path.join(contextDir, 'entities.yaml');
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('entityAdapter', () => {
  it('has format "entity"', () => {
    expect(entityAdapter.format).toBe('entity');
  });

  describe('canHandle', () => {
    it('handles context/entities.yaml', () => {
      expect(entityAdapter.canHandle('context/entities.yaml')).toBe(true);
      expect(entityAdapter.canHandle('/path/to/context/entities.yaml')).toBe(true);
    });

    it('rejects other YAML files', () => {
      expect(entityAdapter.canHandle('config.yaml')).toBe(false);
      expect(entityAdapter.canHandle('entities.yaml')).toBe(false);
      expect(entityAdapter.canHandle('context/workflow.yaml')).toBe(false);
    });

    it('rejects non-YAML files', () => {
      expect(entityAdapter.canHandle('KNOWLEDGE.md')).toBe(false);
      expect(entityAdapter.canHandle('CLAUDE.md')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts entity types with descriptions', async () => {
      const yaml = `entities:
  deal:
    description: A potential sale being pursued
    fields:
      - name: stage
        type: enum
        values: [lead, qualified, closed_won]
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].id).toBe('entity-deal');
        expect(nodes[0].content).toContain('deal');
        expect(nodes[0].content).toContain('A potential sale being pursued');
      });
    });

    it('assigns structural type and navigational tier', async () => {
      const yaml = `entities:
  account:
    description: A company
    fields:
      - name: tier
        type: enum
        values: [strategic, enterprise]
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].type).toBe('structural');
        expect(nodes[0].tier).toBe('navigational');
      });
    });

    it('sets correct origin format and relative path', async () => {
      const yaml = `entities:
  contact:
    description: A person at a company
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].origin.format).toBe('entity');
        expect(nodes[0].origin.relativePath).toBe(path.join('context', 'entities.yaml'));
      });
    });

    it('extracts fields with types and valid values', async () => {
      const yaml = `entities:
  deal:
    description: A sale
    fields:
      - name: stage
        type: enum
        values: [lead, qualified, demo, proposal, closed_won, closed_lost]
      - name: value
        type: currency
      - name: close_date
        type: date
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        const content = nodes[0].content;
        expect(content).toContain('stage');
        expect(content).toContain('enum');
        expect(content).toContain('lead');
        expect(content).toContain('closed_won');
        expect(content).toContain('value');
        expect(content).toContain('currency');
        expect(content).toContain('close_date');
        expect(content).toContain('date');
      });
    });

    it('extracts relationships', async () => {
      const yaml = `entities:
  deal:
    description: A sale
    relationships:
      - type: belongs_to
        target: account
      - type: owned_by
        target: person
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        const content = nodes[0].content;
        expect(content).toContain('belongs_to');
        expect(content).toContain('account');
        expect(content).toContain('owned_by');
        expect(content).toContain('person');
      });
    });

    it('creates one node per entity type', async () => {
      const yaml = `entities:
  deal:
    description: A potential sale
    fields:
      - name: stage
        type: enum
        values: [lead, closed]
  account:
    description: A company
    fields:
      - name: tier
        type: enum
        values: [strategic, smb]
  contact:
    description: A person at a company
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(3);

        const ids = nodes.map((n) => n.id);
        expect(ids).toContain('entity-deal');
        expect(ids).toContain('entity-account');
        expect(ids).toContain('entity-contact');
      });
    });

    it('returns empty array for empty entities', async () => {
      const yaml = `entities: {}
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('returns empty array for missing entities key', async () => {
      const yaml = `metadata:
  version: 1
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('handles entities with no fields or relationships', async () => {
      const yaml = `entities:
  note:
    description: A free-text note attached to something
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].content).toContain('note');
        expect(nodes[0].content).toContain('A free-text note attached to something');
      });
    });

    it('estimates tokens for each node', async () => {
      const yaml = `entities:
  deal:
    description: A potential sale being pursued
    fields:
      - name: stage
        type: enum
        values: [lead, qualified, demo]
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].tokenEstimate).toBeGreaterThan(0);
      });
    });

    it('generates slugified IDs with entity prefix', async () => {
      const yaml = `entities:
  sales_pipeline:
    description: The pipeline
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes[0].id).toBe('entity-sales-pipeline');
      });
    });

    it('handles the canonical KNOWLEDGE.md entity model example', async () => {
      const yaml = `entities:
  deal:
    description: A potential sale being pursued
    fields:
      - name: stage
        type: enum
        values: [lead, qualified, demo, proposal, negotiation, closed_won, closed_lost]
      - name: value
        type: currency
      - name: close_date
        type: date
    relationships:
      - type: belongs_to
        target: account
      - type: owned_by
        target: person

  account:
    description: A company we sell to or want to sell to
    fields:
      - name: tier
        type: enum
        values: [strategic, enterprise, mid-market, smb]
    relationships:
      - type: has_many
        target: deal
      - type: has_many
        target: contact
`;
      await withTempFile(yaml, async (filePath, dir) => {
        const nodes = await entityAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(2);

        const dealNode = nodes.find((n) => n.id === 'entity-deal')!;
        expect(dealNode).toBeDefined();
        expect(dealNode.content).toContain('A potential sale being pursued');
        expect(dealNode.content).toContain('belongs_to');
        expect(dealNode.content).toContain('account');
        expect(dealNode.content).toContain('negotiation');

        const accountNode = nodes.find((n) => n.id === 'entity-account')!;
        expect(accountNode).toBeDefined();
        expect(accountNode.content).toContain('A company we sell to or want to sell to');
        expect(accountNode.content).toContain('has_many');
        expect(accountNode.content).toContain('contact');
      });
    });
  });
});
