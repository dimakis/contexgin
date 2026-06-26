/**
 * Page origin resolver — boosts module context when a session is triggered
 * from a specific page in a multi-module dashboard (e.g. Org Pulse).
 *
 * Maps hash routes (#/<module>/<view>) to module directories and injects
 * the module's sources (module.json, server files, data files) as additional
 * context with a taskHint identifying the active page.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { OriginResolver, SessionOrigin, ResolvedManifest } from './types.js';
import type { ContextSource } from '../compiler/types.js';
import { findModuleDir } from './module-dir.js';

/**
 * Parse a hash route into module name and optional view.
 * Handles formats like:
 *   "releases/coverage" → { module: "releases", view: "coverage" }
 *   "team-tracker"      → { module: "team-tracker", view: undefined }
 *   "#/releases/detail" → { module: "releases", view: "detail" }
 */
function parseRoute(entityId: string): { module: string; view?: string } | undefined {
  // Strip leading #/ or / if present
  const cleaned = entityId.replace(/^#?\/?/, '');
  if (!cleaned) return undefined;

  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;

  return {
    module: segments[0],
    view: segments[1],
  };
}

/**
 * Discover source files for a module directory.
 * Scans for module.json, server/ files, and data/ files.
 */
async function discoverModuleSources(
  modulePath: string,
  workspaceRoot: string,
): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];

  // module.json
  const manifestPath = path.join(modulePath, 'module.json');
  if (await fileExists(manifestPath)) {
    sources.push({
      path: manifestPath,
      kind: 'reference',
      relativePath: path.relative(workspaceRoot, manifestPath),
    });
  }

  // server/ directory — JS/TS files with route definitions
  const serverDir = path.join(modulePath, 'server');
  if (await dirExists(serverDir)) {
    const files = await fs.readdir(serverDir);
    for (const file of files) {
      if (/\.(js|ts|mjs|cjs)$/.test(file)) {
        const fullPath = path.join(serverDir, file);
        sources.push({
          path: fullPath,
          kind: 'reference',
          relativePath: path.relative(workspaceRoot, fullPath),
        });
      }
    }
  }

  // data/ directory — JSON data files
  const dataDir = path.join(modulePath, 'data');
  if (await dirExists(dataDir)) {
    const files = await fs.readdir(dataDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const fullPath = path.join(dataDir, file);
        sources.push({
          path: fullPath,
          kind: 'reference',
          relativePath: path.relative(workspaceRoot, fullPath),
        });
      }
    }
  }

  return sources;
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

export const pageResolver: OriginResolver = {
  source: 'page',

  canHandle(origin: SessionOrigin): boolean {
    return origin.source === 'page';
  },

  async resolve(
    origin: SessionOrigin,
    workspaceRoot: string,
    defaultSources: ContextSource[],
  ): Promise<ResolvedManifest> {
    if (!origin.entityId) return {};

    const parsed = parseRoute(origin.entityId);
    if (!parsed) return {};

    const moduleDir = await findModuleDir(parsed.module, workspaceRoot);
    if (!moduleDir) {
      // Module directory not found — still provide a hint
      return {
        taskHint: `User is on page: ${origin.entityId} (module "${parsed.module}" directory not found)`,
      };
    }

    const moduleSources = await discoverModuleSources(moduleDir, workspaceRoot);

    // Build task hint
    const parts: string[] = [`User is viewing: ${origin.entityId}`];
    parts.push(`Active module: ${parsed.module}`);
    if (parsed.view) {
      parts.push(`Current view: ${parsed.view}`);
    }
    parts.push(`Module path: ${path.relative(workspaceRoot, moduleDir)}`);

    // Merge module sources with defaults, avoiding duplicates
    const existingPaths = new Set(defaultSources.map((s) => s.path));
    const newSources = moduleSources.filter((s) => !existingPaths.has(s.path));

    return {
      sources: newSources.length > 0 ? [...defaultSources, ...newSources] : undefined,
      taskHint: parts.join('\n'),
    };
  },
};
