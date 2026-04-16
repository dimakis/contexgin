/**
 * Claude adapter — parses CLAUDE.md files into typed context nodes.
 * Understands the structure of CLAUDE.md: operational rules, git conventions,
 * entry points, boundaries, and identity sections.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdown, stripFrontmatter } from '../compiler/parser.js';
import { extractAllLevel2, cleanContent } from '../compiler/extractor.js';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode, ContextNodeType, ContextTier } from './types.js';
import { slugify } from './types.js';

/** Classification rules for CLAUDE.md h2 sections */
interface ClassificationRule {
  keywords: string[];
  type: ContextNodeType;
  tier: ContextTier;
}

const RULES: ClassificationRule[] = [
  // Governance — what must/must not happen
  {
    keywords: ['boundary', 'confidential', 'access', 'security', 'privacy'],
    type: 'governance',
    tier: 'constitutional',
  },
  // Identity — who/what this workspace is
  {
    keywords: ['purpose', 'identity', 'about', 'overview'],
    type: 'identity',
    tier: 'identity',
  },
  // Architecture — structural info
  {
    keywords: ['architecture', 'structure', 'directory', 'layout'],
    type: 'structural',
    tier: 'navigational',
  },
  // Operational — how to work (these are essential session instructions)
  {
    keywords: ['git', 'commit', 'branch', 'workflow', 'remote'],
    type: 'operational',
    tier: 'navigational',
  },
  {
    keywords: ['entry point', 'cli', 'command', 'script', 'run'],
    type: 'operational',
    tier: 'navigational',
  },
  {
    keywords: ['worktree', 'session', 'closeout', 'boot'],
    type: 'operational',
    tier: 'navigational',
  },
  {
    keywords: ['memory', 'agent', 'integration'],
    type: 'operational',
    tier: 'navigational',
  },
  {
    keywords: ['jira', 'context', 'workspace', 'environment', 'tool', 'google'],
    type: 'operational',
    tier: 'reference',
  },
  // Reference — pointers to other things
  {
    keywords: ['service', 'health'],
    type: 'reference',
    tier: 'reference',
  },
];

function classifyClaude(headingPath: string[]): { type: ContextNodeType; tier: ContextTier } {
  const text = headingPath.join(' ').toLowerCase();

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return { type: rule.type, tier: rule.tier };
    }
  }

  // Default: operational navigational (CLAUDE.md is primarily operational instructions)
  return { type: 'operational', tier: 'navigational' };
}

export const claudeAdapter: ContextAdapter = {
  format: 'claude_md',

  canHandle(filePath: string): boolean {
    const basename = path.basename(filePath);
    return basename === 'CLAUDE.md';
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
      const { type, tier } = classifyClaude(section.headingPath);
      const lastHeading = section.headingPath[section.headingPath.length - 1];

      return {
        id: slugify(lastHeading),
        type,
        tier,
        content: cleaned,
        origin: {
          source: filePath,
          relativePath: path.relative(workspaceRoot, filePath),
          format: 'claude_md' as const,
          headingPath: section.headingPath,
        },
        tokenEstimate: estimateTokens(cleaned),
      };
    });
  },
};
