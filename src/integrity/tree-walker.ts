import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** A node found on the actual filesystem */
export interface ActualNode {
  /** Relative path, e.g. "src/compiler/" */
  path: string;
  /** Basename, e.g. "compiler" */
  name: string;
  /** Whether this is a file or directory */
  type: 'file' | 'directory';
}

export interface WalkOptions {
  /** Maximum depth to recurse (default: 2) */
  maxDepth: number;
  /** Directory/file names to skip (default: common noise) */
  ignorePatterns: string[];
}

const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  'dist',
  '.venv',
  '__pycache__',
  '.DS_Store',
  '.claude',
];

/**
 * Walk the filesystem from a root directory up to maxDepth levels.
 * Returns a flat array of ActualNode with paths relative to root.
 */
export async function walkFilesystem(
  root: string,
  options?: Partial<WalkOptions>,
): Promise<ActualNode[]> {
  const maxDepth = options?.maxDepth ?? 2;
  const ignorePatterns = options?.ignorePatterns ?? DEFAULT_IGNORE;
  const nodes: ActualNode[] = [];

  await walk(root, '', 0, maxDepth, ignorePatterns, nodes);
  return nodes;
}

async function walk(
  root: string,
  relativePath: string,
  currentDepth: number,
  maxDepth: number,
  ignorePatterns: string[],
  nodes: ActualNode[],
): Promise<void> {
  const fullPath = relativePath ? path.join(root, relativePath) : root;

  let entries;
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignorePatterns.includes(entry.name)) continue;

    const isDir = entry.isDirectory();
    const entryRelative = relativePath
      ? `${relativePath}${entry.name}${isDir ? '/' : ''}`
      : `${entry.name}${isDir ? '/' : ''}`;

    nodes.push({
      path: entryRelative,
      name: entry.name,
      type: isDir ? 'directory' : 'file',
    });

    if (isDir && currentDepth + 1 < maxDepth) {
      await walk(
        root,
        `${relativePath}${entry.name}/`,
        currentDepth + 1,
        maxDepth,
        ignorePatterns,
        nodes,
      );
    }
  }
}
