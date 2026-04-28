import * as path from 'node:path';

/** Resolve `~/` prefix to the user's home directory. */
export function resolveHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.join(home, filePath.slice(2));
  }
  return filePath;
}

/**
 * Validate that a path does not contain path traversal patterns and
 * falls within allowed roots if provided.
 *
 * @param filePath - Path to validate (may contain ~/ prefix)
 * @param allowedRoots - Optional array of allowed root directories
 * @returns Error message if invalid, null if valid
 */
export function validatePath(filePath: string, allowedRoots?: string[]): string | null {
  // Reject paths with .. segments (path traversal)
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    return 'Path contains traversal segments (..)';
  }

  // If allowed roots are specified, ensure the resolved path falls within one of them
  if (allowedRoots && allowedRoots.length > 0) {
    const resolved = path.resolve(resolveHome(filePath));
    const isAllowed = allowedRoots.some((root) => {
      const resolvedRoot = path.resolve(resolveHome(root));
      return resolved.startsWith(resolvedRoot);
    });

    if (!isAllowed) {
      return `Path ${resolved} is not within allowed roots`;
    }
  }

  return null;
}
