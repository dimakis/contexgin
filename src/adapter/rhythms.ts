/**
 * Rhythms adapter — handles context/rhythms.yaml and context/cadence.yaml files.
 * Extracts temporal cadences (daily, weekly, monthly, quarterly rhythms) and
 * represents them as operational context nodes. Rhythms define when things
 * happen — they're operational metadata, not structural or governance content.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

/** Recognized filenames for rhythm/cadence definitions */
const RHYTHM_FILENAMES = new Set(['rhythms.yaml', 'cadence.yaml']);

/**
 * Format a single activity item into a readable line.
 * Handles three shapes:
 *   - string: "standup at 09:15"
 *   - key-value object: { standup: "09:15 — sync" }
 *   - structured object: { name: "standup", time: "09:15", description: "..." }
 */
function formatActivity(item: unknown): string {
  if (typeof item === 'string') {
    return `- ${item}`;
  }
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;

    // Structured form: { name, time?, description? }
    if ('name' in obj) {
      const parts = [String(obj.name)];
      if ('time' in obj) parts.push(String(obj.time));
      if ('description' in obj) parts.push(String(obj.description));
      return `- ${parts.join(' — ')}`;
    }

    // Key-value form: { standup: "09:15 — sync" }
    const entries = Object.entries(obj);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      return `- ${key}: ${String(value)}`;
    }
  }
  return `- ${String(item)}`;
}

export const rhythmsAdapter: ContextAdapter = {
  format: 'rhythms',

  canHandle(filePath: string): boolean {
    const basename = path.basename(filePath);
    if (!RHYTHM_FILENAMES.has(basename)) return false;
    // Must be inside a context/ directory
    const dir = path.basename(path.dirname(filePath));
    return dir === 'context';
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const raw = await fs.readFile(filePath, 'utf-8');
    if (!raw.trim()) return [];

    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object') return [];

    const data = parsed as Record<string, unknown>;
    const nodes: ContextNode[] = [];
    const relativePath = path.relative(workspaceRoot, filePath);

    for (const [period, activities] of Object.entries(data)) {
      if (!Array.isArray(activities) || activities.length === 0) continue;

      const lines = activities.map(formatActivity);
      const content = `## ${period}\n\n${lines.join('\n')}`;

      nodes.push({
        id: slugify(`rhythms-${period}`),
        type: 'operational',
        tier: 'operational',
        content,
        origin: {
          source: filePath,
          relativePath,
          format: 'rhythms',
          headingPath: [period],
        },
        tokenEstimate: estimateTokens(content),
      });
    }

    return nodes;
  },
};
