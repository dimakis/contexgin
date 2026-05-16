/**
 * File origin resolver — injects spoke context when a session is triggered
 * from a specific file or directory path.
 *
 * Maps the file path to its parent spoke (first directory segment relative
 * to workspace root) and injects the spoke's CONSTITUTION.md as additional
 * context with a taskHint identifying the active spoke.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { OriginResolver, SessionOrigin, ResolvedManifest } from './types.js';
import type { ContextSource } from '../compiler/types.js';

/**
 * Extract the spoke name from a file path relative to the workspace root.
 * Returns undefined if the file is at the workspace root (no spoke).
 */
function extractSpokeName(filePath: string, workspaceRoot: string): string | undefined {
  const resolvedFile = path.resolve(filePath);
  const resolvedRoot = path.resolve(workspaceRoot);

  // Get relative path from workspace root
  const relative = path.relative(resolvedRoot, resolvedFile);

  // Outside workspace or at root level
  if (relative.startsWith('..') || relative === '') return undefined;

  const segments = relative.split(path.sep);

  // File at root level (no spoke)
  if (segments.length <= 1) return undefined;

  const firstDir = segments[0];

  // Skip hidden dirs and common non-spoke dirs
  if (firstDir.startsWith('.') || firstDir === 'node_modules' || firstDir === 'dist') {
    return undefined;
  }

  return firstDir;
}

/**
 * Read the first heading or purpose line from a CONSTITUTION.md for a brief description.
 */
async function extractPurpose(constitutionPath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(constitutionPath, 'utf-8');
    const lines = content.split('\n');

    // Look for purpose in first few non-empty, non-heading lines
    for (const line of lines.slice(0, 20)) {
      const trimmed = line.trim();
      // Skip empty lines and the main heading
      if (!trimmed || trimmed.startsWith('# ')) continue;
      // Return first substantive line (often a purpose statement)
      // Threshold lowered to >= 5 to capture terse purposes like "Core lib."
      if (trimmed.length >= 5 && !trimmed.startsWith('#')) {
        return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
      }
    }
  } catch {
    // Can't read — skip
  }
  return undefined;
}

export const fileResolver: OriginResolver = {
  source: 'file',

  canHandle(origin: SessionOrigin): boolean {
    return origin.source === 'file';
  },

  async resolve(
    origin: SessionOrigin,
    workspaceRoot: string,
    defaultSources: ContextSource[],
  ): Promise<ResolvedManifest> {
    const filePath = origin.entityId;
    if (!filePath) return {};

    const spokeName = extractSpokeName(filePath, workspaceRoot);
    if (!spokeName) return {};

    // Check if this spoke has a CONSTITUTION.md
    const constitutionPath = path.join(path.resolve(workspaceRoot), spokeName, 'CONSTITUTION.md');
    const constitutionRelPath = path.join(spokeName, 'CONSTITUTION.md');

    let hasConstitution = false;
    try {
      await fs.access(constitutionPath);
      hasConstitution = true;
    } catch {
      // No spoke constitution
    }

    // Build task hint
    const parts: string[] = [`Working in spoke: ${spokeName}`];

    if (hasConstitution) {
      const purpose = await extractPurpose(constitutionPath);
      if (purpose) {
        parts.push(`Purpose: ${purpose}`);
      }
    }

    const relativePath = path.relative(path.resolve(workspaceRoot), path.resolve(filePath));
    parts.push(`File: ${relativePath}`);

    const manifest: ResolvedManifest = {
      taskHint: parts.join('\n'),
    };

    // Add spoke CONSTITUTION as additional source if not already present
    if (hasConstitution) {
      const alreadyIncluded = defaultSources.some(
        (s) => s.relativePath === constitutionRelPath || s.path === constitutionPath,
      );

      if (!alreadyIncluded) {
        manifest.sources = [
          ...defaultSources,
          {
            path: constitutionPath,
            kind: 'constitution',
            relativePath: constitutionRelPath,
          },
        ];
      }
    }

    return manifest;
  },
};
