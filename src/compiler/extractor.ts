import type { HeadingNode } from './parser.js';
import type { ContextSource, ExtractedSection } from './types.js';
import { estimateTokens } from './trimmer.js';

/**
 * Extract a section by heading path.
 * Path example: ["Architecture", "Hub-and-Spoke Model"] finds:
 *   ## Architecture
 *   ### Hub-and-Spoke Model
 *   [this content]
 *
 * Returns null if the path doesn't match.
 */
export function extractSection(
  nodes: HeadingNode[],
  path: string[],
  source: ContextSource,
): ExtractedSection | null {
  if (path.length === 0) return null;

  const [first, ...rest] = path;
  const node = nodes.find((n) => n.title === first);
  if (!node) return null;

  if (rest.length === 0) {
    // Found the target node — collect its full content including children
    const fullContent = collectFullContent(node);
    return {
      source,
      headingPath: path,
      level: node.level,
      content: fullContent,
      tokenEstimate: estimateTokens(fullContent),
    };
  }

  // Need to go deeper
  const child = extractSection(node.children, rest, source);
  if (!child) return null;
  return {
    ...child,
    headingPath: [first, ...child.headingPath],
  };
}

/**
 * Collect full content of a node including all children's content.
 */
function collectFullContent(node: HeadingNode): string {
  let content = node.content;
  for (const child of node.children) {
    content +=
      '\n' + '#'.repeat(child.level) + ' ' + child.title + '\n' + collectFullContent(child);
  }
  return content;
}

/**
 * Token threshold above which h2 sections are split into h3 sub-sections.
 * Large monolithic sections prevent the trimmer from making granular choices.
 */
const SPLIT_THRESHOLD = 500;

/**
 * Extract all level-2 sections. When an h2 section exceeds SPLIT_THRESHOLD
 * tokens and has h3 children, emit each h3 as a separate section so the
 * trimmer can rank and trim them independently.
 */
export function extractAllLevel2(nodes: HeadingNode[], source: ContextSource): ExtractedSection[] {
  const sections: ExtractedSection[] = [];

  const addH2 = (node: HeadingNode, parentPath: string[]) => {
    const fullContent = collectFullContent(node);
    const tokens = estimateTokens(fullContent);

    if (tokens > SPLIT_THRESHOLD && node.children.length > 0) {
      // Emit the h2's own content (before first child) if non-trivial
      if (node.content.trim()) {
        sections.push({
          source,
          headingPath: [...parentPath, node.title],
          level: node.level,
          content: node.content,
          tokenEstimate: estimateTokens(node.content),
        });
      }
      // Emit each h3 child as its own section
      for (const child of node.children) {
        const childContent = collectFullContent(child);
        sections.push({
          source,
          headingPath: [...parentPath, node.title, child.title],
          level: child.level,
          content: childContent,
          tokenEstimate: estimateTokens(childContent),
        });
      }
    } else {
      // Small enough to keep as one section
      sections.push({
        source,
        headingPath: [...parentPath, node.title],
        level: node.level,
        content: fullContent,
        tokenEstimate: tokens,
      });
    }
  };

  for (const node of nodes) {
    if (node.level === 2) {
      addH2(node, []);
    }
    // Also check children for H2 nodes nested under H1
    for (const child of node.children) {
      if (child.level === 2) {
        addH2(child, [node.title]);
      }
    }
  }

  return sections;
}

/**
 * Clean extracted content:
 * - Remove "See:" and "Applied in:" cross-references
 * - Collapse consecutive blank lines to single blank line
 * - Trim leading/trailing whitespace
 */
export function cleanContent(content: string): string {
  let cleaned = content;

  // Remove See: lines
  cleaned = cleaned.replace(/^See:.*$/gm, '');

  // Remove Applied in: lines
  cleaned = cleaned.replace(/^Applied in:.*$/gm, '');

  // Collapse consecutive blank lines to single blank line
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();

  return cleaned;
}
