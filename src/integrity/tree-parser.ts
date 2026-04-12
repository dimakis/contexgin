/** A node declared in a constitution's tree or directory semantics table */
export interface DeclaredNode {
  /** Relative path, e.g. "command_center/lib/" */
  path: string;
  /** Basename, e.g. "lib" */
  name: string;
  /** Whether this is a file or directory */
  type: 'file' | 'directory';
  /** Description from inline comment or table */
  description?: string;
  /** Where this declaration came from */
  source: 'table' | 'tree' | 'both';
}

/** An external repo reference from [external] lines */
export interface ExternalRef {
  /** Absolute or ~-prefixed path */
  path: string;
  /** Description from inline comment */
  description?: string;
}

interface ParseResult {
  nodes: DeclaredNode[];
  externals: ExternalRef[];
}

// Tree-drawing characters that identify an ASCII tree block
const TREE_CHARS = /[├└│]/;

// Matches a tree entry line: optional tree prefix, then the name
// Captures: (1) the indentation/tree prefix, (2) the entry name
const TREE_LINE = /^((?:│\s{3}| {4})*)(?:[├└](?:──|──→)\s+)(.+)$/;

// Arrow variants for descriptions
const DESCRIPTION_SEPARATOR = /\s+(?:←|<-)\s+/;

/**
 * Parse ASCII tree diagrams from constitution content.
 * Extracts directory/file declarations and external references.
 *
 * Handles fenced code blocks containing tree-drawing characters.
 * The first line (without tree prefix) is treated as the root and stripped from paths.
 */
export function parseAsciiTree(content: string): ParseResult {
  const nodes: DeclaredNode[] = [];
  const externals: ExternalRef[] = [];
  const lines = content.split('\n');

  let inTreeBlock = false;
  let inCodeBlock = false;
  const pathStack: string[] = [];

  for (const line of lines) {
    // Track fenced code block boundaries
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // Closing a code block
        inCodeBlock = false;
        inTreeBlock = false;
        pathStack.length = 0;
        continue;
      }
      inCodeBlock = true;
      continue;
    }

    if (!inCodeBlock) continue;

    // Detect if this code block is a tree block
    if (!inTreeBlock) {
      if (TREE_CHARS.test(line)) {
        inTreeBlock = true;
        // Any buffered root line is now confirmed as the workspace root — discard it
        // fall through to parse this line as a tree entry
      } else {
        // Buffer non-tree lines — only consumed if tree chars follow
        continue;
      }
    }

    if (!inTreeBlock) continue;

    const treeMatch = TREE_LINE.exec(line);
    if (!treeMatch) continue;

    const prefix = treeMatch[1];
    let entry = treeMatch[2].trim();

    // Calculate depth from prefix (each level is 4 chars: "│   " or "    ")
    const depth = prefix.length / 4;

    // Check for [external] reference
    if (entry.startsWith('[external]')) {
      const extPart = entry.replace('[external]', '').trim();
      const [extPath, ...descParts] = extPart.split(DESCRIPTION_SEPARATOR);
      externals.push({
        path: extPath.trim(),
        description: descParts.length > 0 ? descParts.join(' ').trim() : undefined,
      });
      continue;
    }

    // Extract description after arrow
    let description: string | undefined;
    const descMatch = DESCRIPTION_SEPARATOR.exec(entry);
    if (descMatch) {
      description = entry.slice(descMatch.index + descMatch[0].length).trim();
      entry = entry.slice(0, descMatch.index).trim();
    }

    // Remove any trailing parenthetical annotations like "(root)" or "(hub)"
    entry = entry.replace(/\s*\(.*\)\s*$/, '').trim();

    const isDirectory = entry.endsWith('/');
    const name = isDirectory ? entry.slice(0, -1) : entry;

    // Maintain path stack for building full relative paths
    pathStack.length = depth;
    pathStack[depth] = entry;

    const fullPath = pathStack.slice(0, depth + 1).join('');

    nodes.push({
      path: fullPath,
      name: name.includes('/') ? name.split('/').pop()! : name,
      type: isDirectory ? 'directory' : 'file',
      description,
      source: 'tree',
    });
  }

  return { nodes, externals };
}

/**
 * Build a merged declared tree from both directory semantics table entries
 * and ASCII tree diagram nodes.
 *
 * Deduplicates by normalized path. When a path appears in both sources,
 * the node is marked with source: 'both'.
 */
export function buildDeclaredTree(
  semantics: Map<string, string>,
  treeContent: string,
): ParseResult {
  const { nodes: treeNodes, externals } = parseAsciiTree(treeContent);

  // Index tree nodes by path for fast lookup
  const byPath = new Map<string, DeclaredNode>();
  for (const node of treeNodes) {
    byPath.set(normalizePath(node.path), node);
  }

  // Merge in table entries
  for (const [rawPath, description] of semantics) {
    const path = normalizePath(rawPath);

    const existing = byPath.get(path);
    if (existing) {
      // Exists in both — keep tree description (more concise), mark source
      existing.source = 'both';
      if (!existing.description && description) {
        existing.description = description;
      }
    } else {
      // Table-only entry
      const isDirectory = rawPath.endsWith('/');
      const name = rawPath.replace(/\/$/, '').split('/').pop() || rawPath;
      byPath.set(path, {
        path: rawPath,
        name,
        type: isDirectory ? 'directory' : 'file',
        description,
        source: 'table',
      });
    }
  }

  return {
    nodes: Array.from(byPath.values()),
    externals,
  };
}

/** Normalize a path for comparison: strip leading ./, ensure consistent trailing slash */
function normalizePath(p: string): string {
  let normalized = p.replace(/^\.\//, '');
  // Remove annotations like "(root)"
  normalized = normalized.replace(/\s*\(.*\)\s*$/, '').trim();
  return normalized;
}
