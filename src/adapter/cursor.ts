/**
 * Cursor adapter — parses .cursor/rules/*.mdc files into typed context nodes.
 * Understands YAML frontmatter (description, alwaysApply, globs) and uses
 * it alongside content keywords for classification.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode, ContextNodeType, ContextTier } from './types.js';
import { slugify } from './types.js';

/** Parsed frontmatter from an .mdc file */
interface MdcFrontmatter {
  description?: string;
  alwaysApply?: boolean;
  globs?: string;
}

const GOVERNANCE_KEYWORDS = [
  'boundary',
  'confidential',
  'access',
  'security',
  'privacy',
  'governance',
  'principles',
  'never',
  'must not',
];

const OPERATIONAL_KEYWORDS = [
  'commit',
  'branch',
  'workflow',
  'git',
  'lint',
  'format',
  'convention',
  'checkpoint',
  'closeout',
];

/**
 * Strip surrounding quotes (single or double) from a YAML value.
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse a YAML value that may be a JSON-style array (e.g. ["*.ts", "*.tsx"])
 * into a comma-separated string, or return the scalar value unquoted.
 */
function parseGlobsValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(String).join(', ');
      }
    } catch {
      // Not valid JSON array — strip brackets and split manually
      const inner = trimmed.slice(1, trimmed.endsWith(']') ? -1 : undefined);
      return inner
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
        .join(', ');
    }
  }
  return unquote(trimmed);
}

/**
 * Parse YAML frontmatter from .mdc content.
 * Handles quoted values, JSON-style arrays for globs, and CRLF line endings.
 */
function parseFrontmatter(raw: string): { frontmatter: MdcFrontmatter; body: string } {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }

  const endIndex = raw.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: raw };
  }

  // Skip opening "---\n" or "---\r\n"
  const fmStart = raw.indexOf('\n', 0) + 1;
  const fmBlock = raw.slice(fmStart, endIndex);
  const body = raw.slice(endIndex + 4).replace(/^\r?\n/, '');

  const fm: MdcFrontmatter = {};

  for (const rawLine of fmBlock.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'description') {
      fm.description = unquote(value);
    } else if (key === 'alwaysApply') {
      fm.alwaysApply = unquote(value) === 'true';
    } else if (key === 'globs') {
      fm.globs = parseGlobsValue(value);
    }
  }

  return { frontmatter: fm, body };
}

function classifyCursor(
  fm: MdcFrontmatter,
  body: string,
): { type: ContextNodeType; tier: ContextTier } {
  const searchText = [fm.description || '', body].join(' ').toLowerCase();

  // alwaysApply + governance keywords → constitutional governance
  if (fm.alwaysApply && GOVERNANCE_KEYWORDS.some((kw) => searchText.includes(kw))) {
    return { type: 'governance', tier: 'constitutional' };
  }

  // alwaysApply + operational keywords → navigational operational
  if (fm.alwaysApply && OPERATIONAL_KEYWORDS.some((kw) => searchText.includes(kw))) {
    return { type: 'operational', tier: 'navigational' };
  }

  // alwaysApply without specific keywords → still important operational
  if (fm.alwaysApply) {
    return { type: 'operational', tier: 'navigational' };
  }

  // Globs-scoped rules → operational, navigational (scoped to file patterns)
  if (fm.globs) {
    return { type: 'operational', tier: 'navigational' };
  }

  // Default
  return { type: 'operational', tier: 'reference' };
}

export const cursorAdapter: ContextAdapter = {
  format: 'cursor_rules',

  canHandle(filePath: string): boolean {
    return filePath.endsWith('.mdc') && filePath.includes('.cursor/rules');
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);

    if (!body.trim()) {
      return [];
    }

    const { type, tier } = classifyCursor(frontmatter, body);
    const basename = path.basename(filePath, '.mdc');

    const node: ContextNode = {
      id: slugify(basename),
      type,
      tier,
      content: body.trim(),
      origin: {
        source: filePath,
        relativePath: path.relative(workspaceRoot, filePath),
        format: 'cursor_rules',
        ...(frontmatter.globs ? { headingPath: [`globs:${frontmatter.globs}`] } : {}),
      },
      tokenEstimate: estimateTokens(body),
    };

    return [node];
  },
};
