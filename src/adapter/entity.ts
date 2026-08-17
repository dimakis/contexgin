/**
 * Entity model adapter — handles context/entities.yaml files.
 * Extracts entity types, their fields (with type and valid values), and
 * relationships (belongs_to, has_many, owned_by, etc.) as structural context
 * nodes. Entity models define what a workspace tracks — they're navigational
 * metadata that shapes how an agent reasons about the domain.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

/** Shape of a field definition in entities.yaml */
interface EntityField {
  name: string;
  type: string;
  values?: string[];
}

/** Shape of a relationship definition in entities.yaml */
interface EntityRelationship {
  type: string;
  target: string;
}

/** Shape of a single entity definition */
interface EntityDefinition {
  description?: string;
  fields?: EntityField[];
  relationships?: EntityRelationship[];
}

/**
 * Format a field into a readable line.
 * Includes type and valid values when present.
 */
function formatField(field: EntityField): string {
  let line = `- **${field.name}** (${field.type})`;
  if (field.values && field.values.length > 0) {
    line += `: ${field.values.join(', ')}`;
  }
  return line;
}

/**
 * Format a relationship into a readable line.
 */
function formatRelationship(rel: EntityRelationship): string {
  return `- ${rel.type} → ${rel.target}`;
}

/**
 * Build a markdown content block for a single entity type.
 */
function buildEntityContent(name: string, entity: EntityDefinition): string {
  const parts: string[] = [`## Entity: ${name}`];

  if (entity.description) {
    parts.push('', entity.description);
  }

  if (entity.fields && entity.fields.length > 0) {
    parts.push('', '### Fields', '');
    for (const field of entity.fields) {
      parts.push(formatField(field));
    }
  }

  if (entity.relationships && entity.relationships.length > 0) {
    parts.push('', '### Relationships', '');
    for (const rel of entity.relationships) {
      parts.push(formatRelationship(rel));
    }
  }

  return parts.join('\n');
}

export const entityAdapter: ContextAdapter = {
  format: 'entity',

  canHandle(filePath: string): boolean {
    const basename = path.basename(filePath);
    if (basename !== 'entities.yaml') return false;
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
    const entities = data.entities as Record<string, EntityDefinition> | undefined;
    if (!entities || typeof entities !== 'object') return [];

    const nodes: ContextNode[] = [];
    const relativePath = path.relative(workspaceRoot, filePath);

    for (const [name, definition] of Object.entries(entities)) {
      if (!definition || typeof definition !== 'object') continue;

      const content = buildEntityContent(name, definition);

      nodes.push({
        id: slugify(`entity-${name}`),
        type: 'structural',
        tier: 'navigational',
        content,
        origin: {
          source: filePath,
          relativePath,
          format: 'entity' as const,
          headingPath: [name],
        },
        tokenEstimate: estimateTokens(content),
      });
    }

    return nodes;
  },
};
