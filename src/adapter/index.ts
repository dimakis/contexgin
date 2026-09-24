/**
 * Adapter module public API.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadIgnorePatterns, shouldIgnore } from '../graph/ignore.js';
import type { ContextNode } from './types.js';
import { adaptFile } from './registry.js';

/** Files that adapters know how to handle at workspace root level */
const ROOT_FILES = ['CONSTITUTION.md', 'AGENTS.md', 'SERVICES.md', 'README.md', 'KNOWLEDGE.md'];

/**
 * Discover context sources in a workspace and adapt them all into ContextNodes.
 *
 * Discovery order:
 * 1. Root-level known files (AGENTS.md preferred over CLAUDE.md)
 * 2. .cursor/rules/*.mdc files
 * 3. Spoke constitutions and project instructions (see docs/agent-instructions.md)
 * 4. memory/Profile/*.md files
 */
export async function discoverAndAdapt(
  workspaceRoot: string,
  scopePath?: string,
  options: {
    includeSpokes?: boolean;
    includeProfiles?: boolean;
    includeCursorRules?: boolean;
  } = {},
): Promise<ContextNode[]> {
  const root = path.resolve(workspaceRoot);
  const scope = scopePath === undefined ? undefined : path.resolve(root, scopePath);
  if (scope && scope !== root && !scope.startsWith(root + path.sep)) {
    throw new Error('Instruction scope must be inside the workspace');
  }
  if (scope) {
    let current = root;
    for (const part of path.relative(root, scope).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const info = await fs.lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error('Instruction scope must be a directory without symlinks');
      }
    }
  }
  const ignorePatterns = await loadIgnorePatterns(root);
  const allNodes: ContextNode[] = [];

  async function readInstructions(directory: string): Promise<void> {
    const agents = path.join(directory, 'AGENTS.md');
    // Presence determines precedence even when the canonical file is ignored.
    const canonical = await entryExists(agents);
    const selected = canonical ? agents : path.join(directory, 'CLAUDE.md');
    if (shouldIgnore(path.relative(root, selected), ignorePatterns)) return;
    if (await fileExists(selected)) allNodes.push(...(await adaptFile(selected, root)));
  }

  // 1. Root-level files
  for (const file of ROOT_FILES) {
    if (file === 'AGENTS.md') {
      await readInstructions(root);
      continue;
    }
    if (shouldIgnore(file, ignorePatterns)) continue;
    const fullPath = path.join(root, file);
    if (await fileExists(fullPath)) {
      const nodes = await adaptFile(fullPath, root);
      allNodes.push(...nodes);
    }
  }

  // 2. .cursor/rules/*.mdc
  const cursorRulesDir = path.join(root, '.cursor', 'rules');
  if (
    options.includeCursorRules !== false &&
    (await directoryExistsWithoutSymlinks(root, cursorRulesDir))
  ) {
    const files = (await fs.readdir(cursorRulesDir)).sort();
    for (const file of files) {
      if (!file.endsWith('.mdc')) continue;
      const relPath = path.join('.cursor', 'rules', file);
      if (shouldIgnore(relPath, ignorePatterns)) continue;
      const fullPath = path.join(cursorRulesDir, file);
      if (!(await fileExists(fullPath))) continue;
      const nodes = await adaptFile(fullPath, root);
      allNodes.push(...nodes);
    }
  }

  // 3. Spoke-level files (one directory deep). Hub compilation can disable
  // this entire phase so confidential spoke material is never read.
  if (options.includeSpokes !== false) {
    const entries = (await fs.readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      if (shouldIgnore(entry.name + '/', ignorePatterns)) continue;

      if (!scope) await readInstructions(path.join(root, entry.name));
      for (const spokeFile of ['CONSTITUTION.md']) {
        const fullPath = path.join(root, entry.name, spokeFile);
        if (
          !shouldIgnore(path.relative(root, fullPath), ignorePatterns) &&
          (await fileExists(fullPath))
        ) {
          const nodes = await adaptFile(fullPath, root);
          allNodes.push(...nodes);
        }
      }
    }
  }
  if (scope && options.includeSpokes !== false) {
    let directory = root;
    for (const part of path.relative(root, scope).split(path.sep).filter(Boolean)) {
      directory = path.join(directory, part);
      if (!shouldIgnore(path.relative(root, directory) + '/', ignorePatterns)) {
        await readInstructions(directory);
      }
    }
  }

  // 4. memory/Profile/*.md
  const profileDir = path.join(root, 'memory', 'Profile');
  if (
    options.includeProfiles !== false &&
    (await directoryExistsWithoutSymlinks(root, profileDir))
  ) {
    const files = (await fs.readdir(profileDir)).sort();
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const relPath = path.join('memory', 'Profile', file);
      if (shouldIgnore(relPath, ignorePatterns)) continue;
      const fullPath = path.join(profileDir, file);
      if (!(await fileExists(fullPath))) continue;
      const nodes = await adaptFile(fullPath, root);
      allNodes.push(...nodes);
    }
  }

  return allNodes;
}

async function entryExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const info = await fs.lstat(p);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function directoryExistsWithoutSymlinks(root: string, directory: string): Promise<boolean> {
  const relative = path.relative(root, directory);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;

  let current = root;
  try {
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const info = await fs.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Re-exports
export { findAdapter, adaptFile } from './registry.js';
export { agentsAdapter } from './agents.js';
export { claudeAdapter } from './claude.js';
export { cursorAdapter } from './cursor.js';
export { constitutionAdapter } from './constitution.js';
export { knowledgeAdapter } from './knowledge.js';
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
export {
  isNestedPath,
  isProfilePath,
  slugify,
  TIER_WEIGHTS,
  nodeToSourceKind,
  nodesToSources,
} from './types.js';
