import * as path from 'node:path';

/** Resolve `~/` prefix to the user's home directory. */
export function resolveHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.join(home, filePath.slice(2));
  }
  return filePath;
}
