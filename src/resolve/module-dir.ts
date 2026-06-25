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

/**
 * Find a module directory by name across common locations.
 * Returns the first match or undefined.
 */
export async function findModuleDir(
  moduleName: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  // Reject path traversal attempts
  if (moduleName.includes('..') || path.isAbsolute(moduleName)) return undefined;

  for (const pattern of MODULE_DIR_PATTERNS) {
    const candidate = pattern
      ? path.join(workspaceRoot, pattern, moduleName)
      : path.join(workspaceRoot, moduleName);

    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
