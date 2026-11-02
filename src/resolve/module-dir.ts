/**
 * Shared utility for finding module directories across common locations.
 * Used by both the page resolver and the recipe compiler's dynamic block resolution.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Module directory candidate locations, checked in order.
 */
const MODULE_DIR_PATTERNS = ['modules', 'src/modules', ''];
const NON_MODULE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

/**
 * Find a module directory by name across common locations.
 * Returns the first match or undefined.
 */
export async function findModuleDir(
  moduleName: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  // Reject path traversal attempts
  if (!/^[a-zA-Z0-9_-]+$/.test(moduleName)) return undefined;

  const rootRealPath = await fs.realpath(workspaceRoot);

  for (const pattern of MODULE_DIR_PATTERNS) {
    // Root-level modules are supported, but generated directories are not modules.
    if (!pattern && NON_MODULE_DIRS.has(moduleName)) continue;
    const candidate = pattern
      ? path.join(workspaceRoot, pattern, moduleName)
      : path.join(workspaceRoot, moduleName);

    try {
      const realPath = await fs.realpath(candidate);
      if (!realPath.startsWith(rootRealPath + path.sep)) continue;
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
