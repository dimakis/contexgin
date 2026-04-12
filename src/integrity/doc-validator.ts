import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Claim, ClaimResult, CountClaim, ListClaim } from './types.js';

// ── Glob Matching ────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a regex.
 * Supports: *, **, ?, and character classes.
 */
function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any number of directories
        if (pattern[i + 2] === '/') {
          regex += '(?:.+/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        regex += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i++;
    } else if (ch === '[') {
      // Character class — pass through
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        regex += '\\[';
        i++;
      } else {
        regex += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else if ('.+^${}()|\\'.includes(ch)) {
      regex += '\\' + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }

  return new RegExp('^' + regex + '$');
}

/**
 * Recursively walk a directory and return all file paths relative to root.
 */
async function walkDir(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath);

      if (entry.isDirectory()) {
        results.push(relativePath + '/');
        const subResults = await walkDir(fullPath, root);
        results.push(...subResults);
      } else {
        results.push(relativePath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return results;
}

/**
 * Find files matching a glob pattern within a workspace.
 * Returns relative paths.
 */
async function findByGlob(pattern: string, searchRoot: string): Promise<string[]> {
  const regex = globToRegex(pattern);
  const allPaths = await walkDir(searchRoot, searchRoot);
  return allPaths.filter((p) => regex.test(p));
}

/**
 * Find files whose content matches a grep regex within a workspace.
 * Returns relative paths.
 */
async function findByGrep(pattern: string, searchRoot: string): Promise<string[]> {
  const regex = new RegExp(pattern);
  const allPaths = await walkDir(searchRoot, searchRoot);
  const matches: string[] = [];

  for (const relPath of allPaths) {
    // Skip directories
    if (relPath.endsWith('/')) continue;

    try {
      const content = await fs.readFile(path.join(searchRoot, relPath), 'utf-8');
      if (regex.test(content)) {
        matches.push(relPath);
      }
    } catch {
      // Can't read file — skip
    }
  }

  return matches;
}

// ── Stem Extraction ──────────────────────────────────────────────

/**
 * Extract an item name from a file path.
 * For glob results: filename stem (without extension).
 * For grep results: the match group if available, otherwise filename stem.
 */
function extractStem(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

// ── Validation ───────────────────────────────────────────────────

/**
 * Validate a count_matches claim.
 */
async function validateCountClaim(claim: CountClaim, workspaceRoot: string): Promise<ClaimResult> {
  const searchRoot = claim.searchPath ? path.join(workspaceRoot, claim.searchPath) : workspaceRoot;

  const finder = claim.strategy === 'grep' ? findByGrep : findByGlob;
  const matches = await finder(claim.target, searchRoot);
  const actualCount = matches.length;

  if (actualCount === claim.expectedCount) {
    return {
      claim,
      valid: true,
      message: `${claim.source} claims ${claim.expectedCount} ${claim.noun} — confirmed (${actualCount} found)`,
    };
  }

  return {
    claim,
    valid: false,
    actual: String(actualCount),
    message: `${claim.source} claims ${claim.expectedCount} ${claim.noun} but found ${actualCount} matching ${claim.target}`,
  };
}

/**
 * Validate a list_complete claim.
 */
async function validateListClaim(claim: ListClaim, workspaceRoot: string): Promise<ClaimResult> {
  const searchRoot = claim.searchPath ? path.join(workspaceRoot, claim.searchPath) : workspaceRoot;

  const finder = claim.strategy === 'grep' ? findByGrep : findByGlob;
  const matches = await finder(claim.target, searchRoot);
  const actualItems = matches.map(extractStem);
  const actualSet = new Set(actualItems);
  const listedSet = new Set(claim.listedItems);

  const inDocNotFound = claim.listedItems.filter((item) => !actualSet.has(item));
  const foundNotInDoc = actualItems.filter((item) => !listedSet.has(item));

  const valid = inDocNotFound.length === 0 && foundNotInDoc.length === 0;

  if (valid) {
    return {
      claim,
      valid: true,
      message: `${claim.source} list is complete — all ${claim.listedItems.length} items match`,
    };
  }

  const parts: string[] = [];
  if (inDocNotFound.length > 0) {
    parts.push(`documented but not found: ${inDocNotFound.join(', ')}`);
  }
  if (foundNotInDoc.length > 0) {
    parts.push(`found but not documented: ${foundNotInDoc.join(', ')}`);
  }

  return {
    claim,
    valid: false,
    actual: `${actualItems.length} items on disk`,
    message: `${claim.source} list mismatch — ${parts.join('; ')}`,
  };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Validate doc consistency claims against the filesystem.
 *
 * Handles count_matches and list_complete claim kinds.
 * Other claim kinds are passed through unchanged.
 */
export async function validateDocClaims(
  claims: Claim[],
  workspaceRoot: string,
): Promise<ClaimResult[]> {
  const results: ClaimResult[] = [];

  for (const claim of claims) {
    switch (claim.kind) {
      case 'count_matches': {
        results.push(await validateCountClaim(claim as CountClaim, workspaceRoot));
        break;
      }
      case 'list_complete': {
        results.push(await validateListClaim(claim as ListClaim, workspaceRoot));
        break;
      }
      default: {
        // Not a doc claim — skip (handled by existing validator)
        break;
      }
    }
  }

  return results;
}

// Export utilities for testing
export { findByGlob, findByGrep, extractStem };
