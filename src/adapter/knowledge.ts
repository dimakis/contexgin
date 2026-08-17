/**
 * Knowledge adapter — handles KNOWLEDGE.md files.
 * Assigns sections to 'operational' tier so they rank above generic markdown
 * but below constitutional content. KNOWLEDGE.md is an operating manual —
 * it defines how the workspace works, not what it is.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdown, stripFrontmatter } from '../compiler/parser.js';
import { extractAllLevel2, cleanContent } from '../compiler/extractor.js';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

export const knowledgeAdapter: ContextAdapter = {
  format: 'knowledge',

  canHandle(filePath: string): boolean {
    return path.basename(filePath) === 'KNOWLEDGE.md';
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
      const lastHeading = section.headingPath[section.headingPath.length - 1];

      return {
        id: slugify(`knowledge-${lastHeading}`),
        type: 'operational',
        tier: 'operational',
        content: cleaned,
        origin: {
          source: filePath,
          relativePath: path.relative(workspaceRoot, filePath),
          format: 'knowledge' as const,
          headingPath: section.headingPath,
        },
        tokenEstimate: estimateTokens(cleaned),
      };
    });
  },
};
