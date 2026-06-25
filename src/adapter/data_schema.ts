/**
 * Data schema adapter — extracts column names, types, and record counts
 * from JSON data files. Provides structural context about available datasets.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

/** Inferred column schema */
interface ColumnSchema {
  name: string;
  type: string;
  sampleValues?: string[];
}

/**
 * Infer the JS type of a value, with null/undefined handling.
 */
function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Extract column schema from an array of objects.
 * Samples the first few records to determine column names and types.
 */
function extractColumns(records: Record<string, unknown>[]): ColumnSchema[] {
  if (records.length === 0) return [];

  // Collect all unique keys across the first 10 records
  const sampleSize = Math.min(records.length, 10);
  const sample = records.slice(0, sampleSize);
  const keys = new Set<string>();

  for (const record of sample) {
    for (const key of Object.keys(record)) {
      keys.add(key);
    }
  }

  return Array.from(keys).map((key) => {
    // Determine predominant type from sample
    const types = sample.filter((r) => key in r).map((r) => inferType(r[key]));
    const uniqueTypes = [...new Set(types)];
    const type = uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ');

    return { name: key, type };
  });
}

/**
 * Format extracted schema into readable markdown context.
 */
function formatSchema(columns: ColumnSchema[], fileName: string, recordCount: number): string {
  const parts: string[] = [`## Data: ${fileName}`];

  parts.push(`**Records:** ${recordCount}`);

  if (columns.length === 0) {
    parts.push('No columns discovered.');
    return parts.join('\n\n');
  }

  parts.push(`**Columns:** ${columns.length}`);

  const table = ['| Column | Type |', '|--------|------|'];
  for (const col of columns) {
    table.push(`| \`${col.name}\` | ${col.type} |`);
  }
  parts.push(table.join('\n'));

  return parts.join('\n\n');
}

export const dataSchemaAdapter: ContextAdapter = {
  format: 'json_data',

  canHandle(filePath: string): boolean {
    if (!filePath.endsWith('.json')) return false;
    const lowerPath = filePath.toLowerCase();
    // Match JSON files in data/ directories, excluding config files
    return (
      lowerPath.includes('/data/') &&
      !path.basename(filePath).startsWith('.') &&
      path.basename(filePath) !== 'package.json' &&
      path.basename(filePath) !== 'tsconfig.json'
    );
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    // Only handle arrays of objects (tabular data)
    if (!Array.isArray(parsed)) return [];
    const records = parsed.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
    if (records.length === 0) return [];

    const columns = extractColumns(records);
    const relativePath = path.relative(workspaceRoot, filePath);
    const content = formatSchema(columns, relativePath, records.length);

    return [
      {
        id: `data-${slugify(path.basename(filePath, '.json'))}`,
        type: 'structural',
        tier: 'reference',
        content,
        origin: {
          source: filePath,
          relativePath,
          format: 'json_data',
        },
        tokenEstimate: estimateTokens(content),
      },
    ];
  },
};
