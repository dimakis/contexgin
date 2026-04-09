export interface HeadingNode {
  level: number;
  title: string;
  content: string;
  children: HeadingNode[];
  line: number;
}

/**
 * Strip YAML frontmatter (between --- delimiters) from markdown.
 */
export function stripFrontmatter(source: string): string {
  if (!source.startsWith('---')) {
    return source;
  }
  const endIndex = source.indexOf('\n---', 3);
  if (endIndex === -1) {
    return source;
  }
  // Skip past the closing --- and the newline after it
  const afterFrontmatter = endIndex + 4;
  return source.slice(afterFrontmatter).replace(/^\n/, '');
}

/**
 * Parse a markdown file into a tree of heading nodes.
 * Respects heading hierarchy: H2 is child of H1, H3 is child of H2, etc.
 */
export function parseMarkdown(source: string): HeadingNode[] {
  const lines = source.split('\n');
  const headingRegex = /^(#{1,6})\s+(.+)$/;

  // First pass: identify all headings and their line numbers, respecting code blocks
  interface RawHeading {
    level: number;
    title: string;
    lineNumber: number;
    lineIndex: number;
  }

  const headings: RawHeading[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code block boundaries
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    const match = headingRegex.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        lineNumber: i + 1, // 1-based
        lineIndex: i,
      });
    }
  }

  if (headings.length === 0) {
    return [];
  }

  // Second pass: extract content for each heading
  const flatNodes: HeadingNode[] = headings.map((h, idx) => {
    const startLine = h.lineIndex + 1; // content starts after heading line
    const endLine = idx < headings.length - 1 ? headings[idx + 1].lineIndex : lines.length;

    const contentLines = lines.slice(startLine, endLine);
    const content = contentLines.join('\n');

    return {
      level: h.level,
      title: h.title,
      content,
      children: [],
      line: h.lineNumber,
    };
  });

  // Third pass: build tree based on heading hierarchy
  // We need to separate "own content" from children content
  return buildTree(flatNodes);
}

function buildTree(flatNodes: HeadingNode[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const node of flatNodes) {
    // Pop stack until we find a parent (lower level number)
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      parent.children.push(node);

      // Trim parent's content to only include text before this child heading
      // We need to remove child heading content from parent content
      trimParentContent(parent, node);
    }

    stack.push(node);
  }

  return roots;
}

function trimParentContent(parent: HeadingNode, child: HeadingNode): void {
  // The parent's content currently includes everything up to the next same-or-higher-level heading.
  // We need to cut off at the child heading line.
  // Since content was extracted as lines between this heading and the next heading at the same level,
  // we need to find where the child heading appears within the parent's content and trim there.
  const parentContentLines = parent.content.split('\n');
  const headingPattern = '#'.repeat(child.level) + ' ' + child.title;

  let cutIndex = -1;
  let inCodeBlock = false;
  for (let i = 0; i < parentContentLines.length; i++) {
    const line = parentContentLines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock && line.trim() === headingPattern) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex >= 0) {
    parent.content = parentContentLines.slice(0, cutIndex).join('\n');
  }
}
