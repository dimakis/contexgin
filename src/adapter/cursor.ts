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
 * Parse YAML-like frontmatter from .mdc content.
 * Handles the simple key: value format used by Cursor rules.
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
      fm.description = value;
    } else if (key === 'alwaysApply') {
      fm.alwaysApply = value === 'true';
    } else if (key === 'globs') {
      fm.globs = value;
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
