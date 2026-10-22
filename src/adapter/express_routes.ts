/**
 * Express routes adapter — extracts API route paths from Express server files.
 * Scans for router.get/post/put/delete/patch/use patterns and builds
 * a structural context node listing all discovered endpoints.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

/** A discovered route */
interface Route {
  method: string;
  path: string;
}

/**
 * Extract Express-style route definitions from JavaScript/TypeScript source.
 * Matches patterns like:
 *   router.get('/api/foo', ...)
 *   app.post("/bar", ...)
 *   router.use('/prefix', ...)
 */
function extractRoutes(source: string): Route[] {
  const routePattern =
    /(?:router|app|server)\.(get|post|put|delete|patch|use)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const routes: Route[] = [];
  let match: RegExpExecArray | null;

  while ((match = routePattern.exec(source)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
    });
  }

  return routes;
}

/**
 * Format discovered routes into readable markdown context.
 */
function formatRoutes(routes: Route[], fileName: string): string {
  const parts: string[] = [`## API Routes: ${fileName}`];

  if (routes.length === 0) {
    parts.push('No routes discovered.');
    return parts.join('\n\n');
  }

  parts.push(`${routes.length} endpoint(s):`);

  const lines = routes.map((r) => `- \`${r.method} ${r.path}\``);
  parts.push(lines.join('\n'));

  return parts.join('\n\n');
}

export const expressRoutesAdapter: ContextAdapter = {
  format: 'express_routes',

  canHandle(filePath: string): boolean {
    const basename = path.basename(filePath);
    const ext = path.extname(filePath);
    // Match JS/TS files in server/ directories or named *routes* / *router*
    if (!['.js', '.ts', '.mjs', '.cjs'].includes(ext)) return false;
    const lowerPath = filePath.toLowerCase();
    return (
      lowerPath.includes('/server/') ||
      basename.toLowerCase().includes('route') ||
      basename.toLowerCase().includes('router')
    );
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const source = await fs.readFile(filePath, 'utf-8');
    const routes = extractRoutes(source);

    // Skip files with no routes — don't pollute context
    if (routes.length === 0) return [];

    const fileName = path.relative(workspaceRoot, filePath);
    const content = formatRoutes(routes, fileName);

    return [
      {
        id: `routes-${slugify(path.basename(filePath, path.extname(filePath)))}`,
        type: 'structural',
        tier: 'navigational',
        content,
        origin: {
          source: filePath,
          relativePath: fileName,
          format: 'express_routes',
        },
        tokenEstimate: estimateTokens(content),
      },
    ];
  },
};
