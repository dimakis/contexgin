/**
 * Markdown adapter — fallback adapter for generic .md files.
 * Wraps the existing compiler extractor + ranker classification.
 * This is the migration bridge: existing behavior preserved as a ContextAdapter.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdown, stripFrontmatter } from '../compiler/parser.js';
import { extractAllLevel2, cleanContent } from '../compiler/extractor.js';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode, ContextNodeType, ContextTier } from './types.js';
import { slugify } from './types.js';

/** Heading keywords → type + tier classification */
const CONSTITUTIONAL_KEYWORDS = ['principles', 'boundaries', 'constitution', 'governance'];
const NAVIGATIONAL_KEYWORDS = [
  'architecture',
  'directory',
  'structure',
  'entry point',
  'navigation',
  'layout',
];
const IDENTITY_KEYWORDS = ['purpose', 'identity', 'about', 'profile', 'who'];
const HISTORICAL_KEYWORDS = ['session', 'history', 'decisions', 'log', 'journal'];

function classify(headingPath: string[]): { type: ContextNodeType; tier: ContextTier } {
  const text = headingPath.join(' ').toLowerCase();

  if (CONSTITUTIONAL_KEYWORDS.some((kw) => text.includes(kw))) {
    return { type: 'governance', tier: 'constitutional' };
  }
  if (NAVIGATIONAL_KEYWORDS.some((kw) => text.includes(kw))) {
    return { type: 'structural', tier: 'navigational' };
  }
  if (IDENTITY_KEYWORDS.some((kw) => text.includes(kw))) {
    return { type: 'identity', tier: 'identity' };
  }
  if (HISTORICAL_KEYWORDS.some((kw) => text.includes(kw))) {
    return { type: 'reference', tier: 'historical' };
  }

  return { type: 'reference', tier: 'reference' };
}

export const markdownAdapter: ContextAdapter = {
  format: 'markdown',

  canHandle(filePath: string): boolean {
    return filePath.endsWith('.md');
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const content = stripFrontmatter(raw);
    const nodes = parseMarkdown(content);
    const sections = extractAllLevel2(nodes, {
      path: filePath,
      kind: 'reference',
      relativePath: path.relative(workspaceRoot, filePath),
    });

    return sections.map((section) => {
      const cleaned = cleanContent(section.content);
      const { type, tier } = classify(section.headingPath);
      const lastHeading = section.headingPath[section.headingPath.length - 1];

      return {
        id: slugify(lastHeading),
        type,
        tier,
        content: cleaned,
        origin: {
          source: filePath,
          relativePath: path.relative(workspaceRoot, filePath),
          format: 'markdown' as const,
          headingPath: section.headingPath,
        },
        tokenEstimate: estimateTokens(cleaned),
      };
    });
  },
};
