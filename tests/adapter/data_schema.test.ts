import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { dataSchemaAdapter } from '../../src/adapter/data_schema.js';

async function withTempFile(
  content: string,
  filePath: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const fullPath = path.join(dir, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  try {
    await fn(fullPath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('dataSchemaAdapter', () => {
  it('has format "json_data"', () => {
    expect(dataSchemaAdapter.format).toBe('json_data');
  });

  describe('canHandle', () => {
    it('handles JSON files in data/ directories', () => {
      expect(dataSchemaAdapter.canHandle('/app/data/teams.json')).toBe(true);
      expect(dataSchemaAdapter.canHandle('/app/modules/releases/data/versions.json')).toBe(true);
    });

    it('rejects JSON files not in data/', () => {
      expect(dataSchemaAdapter.canHandle('/app/config.json')).toBe(false);
      expect(dataSchemaAdapter.canHandle('/app/src/types.json')).toBe(false);
    });

    it('rejects package.json and tsconfig.json in data/', () => {
      expect(dataSchemaAdapter.canHandle('/app/data/package.json')).toBe(false);
      expect(dataSchemaAdapter.canHandle('/app/data/tsconfig.json')).toBe(false);
    });

    it('rejects non-JSON files', () => {
      expect(dataSchemaAdapter.canHandle('/app/data/readme.md')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts column names and types from array of objects', async () => {
      const data = JSON.stringify([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false },
      ]);

      await withTempFile(data, 'data/users.json', async (filePath, dir) => {
        const nodes = await dataSchemaAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe('structural');
        expect(nodes[0].tier).toBe('reference');
        expect(nodes[0].content).toContain('**Records:** 2');
        expect(nodes[0].content).toContain('**Columns:** 3');
        expect(nodes[0].content).toContain('`name`');
        expect(nodes[0].content).toContain('string');
        expect(nodes[0].content).toContain('`age`');
        expect(nodes[0].content).toContain('number');
        expect(nodes[0].content).toContain('`active`');
        expect(nodes[0].content).toContain('boolean');
      });
    });

    it('returns empty for non-array JSON', async () => {
      const data = JSON.stringify({ key: 'value', nested: { a: 1 } });

      await withTempFile(data, 'data/config.json', async (filePath, dir) => {
        const nodes = await dataSchemaAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('returns empty for empty arrays', async () => {
      await withTempFile('[]', 'data/empty.json', async (filePath, dir) => {
        const nodes = await dataSchemaAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('handles mixed types across records', async () => {
      const data = JSON.stringify([{ value: 'hello' }, { value: 42 }]);

      await withTempFile(data, 'data/mixed.json', async (filePath, dir) => {
        const nodes = await dataSchemaAdapter.adapt(filePath, dir);
        expect(nodes[0].content).toContain('string | number');
      });
    });

    it('handles null values', async () => {
      const data = JSON.stringify([{ name: 'Test', score: null }]);

      await withTempFile(data, 'data/nulls.json', async (filePath, dir) => {
        const nodes = await dataSchemaAdapter.adapt(filePath, dir);
        expect(nodes[0].content).toContain('null');
      });
    });

    it('sets correct origin and ID', async () => {
      const data = JSON.stringify([{ x: 1 }]);

      await withTempFile(data, 'data/metrics.json', async (filePath, dir) => {
        const nodes = await dataSchemaAdapter.adapt(filePath, dir);
        expect(nodes[0].id).toBe('data-metrics');
        expect(nodes[0].origin.format).toBe('json_data');
        expect(nodes[0].origin.relativePath).toBe(path.join('data', 'metrics.json'));
      });
    });
  });
});
