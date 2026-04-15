/**
 * Adapter registry — ordered dispatch of file paths to adapters.
 * More specific adapters are checked first; markdown is the fallback.
 */

import type { ContextAdapter, ContextNode } from './types.js';
import { constitutionAdapter } from './constitution.js';
import { claudeAdapter } from './claude.js';
import { cursorAdapter } from './cursor.js';
import { markdownAdapter } from './markdown.js';

/**
 * Ordered list of adapters. More specific adapters first.
 * Constitution and Claude must be checked before markdown fallback.
 */
const ADAPTERS: ContextAdapter[] = [
  constitutionAdapter,
  claudeAdapter,
  cursorAdapter,
  markdownAdapter, // fallback — must be last
];

/**
 * Find the adapter that can handle a given file path.
 * Returns undefined if no adapter matches.
 */
export function findAdapter(filePath: string): ContextAdapter | undefined {
  return ADAPTERS.find((a) => a.canHandle(filePath));
}

/**
 * Adapt a single file using the appropriate adapter.
 * Returns empty array if no adapter matches or if the adapter throws.
 * Error isolation: one bad file never fails the whole pipeline.
 */
export async function adaptFile(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
  const adapter = findAdapter(filePath);
  if (!adapter) return [];
  try {
    return await adapter.adapt(filePath, workspaceRoot);
  } catch (err) {
    // Log but don't propagate — same resilience as the original compile() pipeline
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[contexgin] adapter ${adapter.format} failed for ${filePath}: ${msg}`);
    return [];
  }
}
