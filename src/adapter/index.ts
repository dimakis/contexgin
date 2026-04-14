/**
 * Adapter module public API.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadIgnorePatterns, shouldIgnore } from '../graph/ignore.js';
import type { ContextNode } from './types.js';
import { adaptFile } from './registry.js';

/** Files that adapters know how to handle at workspace root level */
const ROOT_FILES = ['CONSTITUTION.md', 'CLAUDE.md', 'SERVICES.md', 'README.md'];

/**
 * Discover context sources in a workspace and adapt them all into ContextNodes.
 *
 * Discovery order:
 * 1. Root-level known files (CONSTITUTION.md, CLAUDE.md, etc.)
 * 2. .cursor/rules/*.mdc files
 * 3. Spoke-level CONSTITUTION.md and CLAUDE.md (one level deep)
 * 4. memory/Profile/*.md files
 */
export async function discoverAndAdapt(workspaceRoot: string): Promise<ContextNode[]> {
  const root = path.resolve(workspaceRoot);
  const ignorePatterns = await loadIgnorePatterns(root);
  const allNodes: ContextNode[] = [];

  // 1. Root-level files
  for (const file of ROOT_FILES) {
    const fullPath = path.join(root, file);
    if (await fileExists(fullPath)) {
      const nodes = await adaptFile(fullPath, root);
      allNodes.push(...nodes);
    }
  }

  // 2. .cursor/rules/*.mdc
  const cursorRulesDir = path.join(root, '.cursor', 'rules');
  if (await dirExists(cursorRulesDir)) {
    const files = await fs.readdir(cursorRulesDir);
    for (const file of files) {
      if (!file.endsWith('.mdc')) continue;
      const fullPath = path.join(cursorRulesDir, file);
      const nodes = await adaptFile(fullPath, root);
      allNodes.push(...nodes);
    }
  }

  // 3. Spoke-level files (one directory deep)
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      if (shouldIgnore(entry.name + '/', ignorePatterns)) continue;

      for (const spokeFile of ['CONSTITUTION.md', 'CLAUDE.md']) {
        const fullPath = path.join(root, entry.name, spokeFile);
        if (await fileExists(fullPath)) {
          const nodes = await adaptFile(fullPath, root);
          allNodes.push(...nodes);
        }
      }
    }
  } catch {
    // Directory listing failed — skip spoke discovery
  }

  // 4. memory/Profile/*.md
  const profileDir = path.join(root, 'memory', 'Profile');
  if (await dirExists(profileDir)) {
    const files = await fs.readdir(profileDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const fullPath = path.join(profileDir, file);
      const nodes = await adaptFile(fullPath, root);
      allNodes.push(...nodes);
    }
  }

  return allNodes;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Re-exports
export { findAdapter, adaptFile } from './registry.js';
export { claudeAdapter } from './claude.js';
export { cursorAdapter } from './cursor.js';
export { constitutionAdapter } from './constitution.js';
export { markdownAdapter } from './markdown.js';
export type {
  ContextNode,
  ContextNodeType,
  ContextTier,
  ContextAdapter,
  RankedNode,
  NodeOrigin,
  SourceFormat,
} from './types.js';
export { slugify, TIER_WEIGHTS } from './types.js';
