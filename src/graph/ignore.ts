import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** Default patterns applied even without a .centaurignore file */
const DEFAULT_PATTERNS = [
  '.git/',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '.venv/',
  'dist/',
  '.claude/',
];

export interface IgnorePatterns {
  /** The ignore instance for pattern matching */
  matcher: Ignore;
  /** Whether a .centaurignore file was found */
  hasFile: boolean;
  /** The hub root this was loaded from */
  root: string;
}

/**
 * Load ignore patterns from a .centaurignore file at the hub root.
 * Always includes default patterns even if no file exists.
 */
export async function loadIgnorePatterns(hubRoot: string): Promise<IgnorePatterns> {
  const matcher = ignore();

  // Always add defaults
  matcher.add(DEFAULT_PATTERNS);

  // Try to load .centaurignore
  const ignorePath = path.join(hubRoot, '.centaurignore');
  let hasFile = false;

  try {
    const content = await fs.readFile(ignorePath, 'utf-8');
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    matcher.add(lines);
    hasFile = true;
  } catch {
    // No .centaurignore — defaults only
  }

  return { matcher, hasFile, root: hubRoot };
}

/**
 * Check if a relative path should be ignored.
 * Path must be relative to the hub root (no leading slash).
 */
export function shouldIgnore(relativePath: string, patterns: IgnorePatterns): boolean {
  // Normalize: strip leading ./ or /
  const clean = relativePath.replace(/^\.?\//, '');
  if (!clean) return false;

  return patterns.matcher.ignores(clean);
}
