/**
 * Module manifest adapter — parses module.json files into typed context nodes.
 * Each module.json describes a UI module: name, views, nav items, description.
 * Used for Org Pulse and similar multi-module dashboards.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

/** Expected shape of a module.json file */
interface ModuleManifest {
  name?: string;
  description?: string;
  views?: Array<{ name?: string; path?: string; description?: string }>;
  navItems?: Array<{ label?: string; path?: string; icon?: string }>;
  defaultEnabled?: boolean;
  [key: string]: unknown;
}

/**
 * Format a module manifest into readable markdown context.
 */
function formatManifest(manifest: ModuleManifest, moduleDirName: string): string {
  const parts: string[] = [];
  const name = manifest.name ?? moduleDirName;

  parts.push(`## Module: ${name}`);

  if (manifest.description) {
    parts.push(manifest.description);
  }

  if (manifest.defaultEnabled !== undefined) {
    parts.push(`**Enabled by default:** ${manifest.defaultEnabled ? 'yes' : 'no'}`);
  }

  if (manifest.views && manifest.views.length > 0) {
    parts.push('### Views');
    for (const view of manifest.views) {
      const viewName = view.name ?? view.path ?? 'unnamed';
      const desc = view.description ? ` — ${view.description}` : '';
      parts.push(`- \`${viewName}\`${desc}`);
    }
  }

  if (manifest.navItems && manifest.navItems.length > 0) {
    parts.push('### Navigation');
    for (const item of manifest.navItems) {
      const label = item.label ?? item.path ?? 'unnamed';
      const pathStr = item.path ? ` → \`${item.path}\`` : '';
      parts.push(`- ${label}${pathStr}`);
    }
  }

  return parts.join('\n\n');
}

export const moduleManifestAdapter: ContextAdapter = {
  format: 'json_manifest',

  canHandle(filePath: string): boolean {
    return path.basename(filePath) === 'module.json';
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const manifest: ModuleManifest = JSON.parse(raw);
    const moduleDirName = path.basename(path.dirname(filePath));
    const content = formatManifest(manifest, moduleDirName);

    return [
      {
        id: `module-${slugify(manifest.name ?? moduleDirName)}`,
        type: 'structural',
        tier: 'navigational',
        content,
        origin: {
          source: filePath,
          relativePath: path.relative(workspaceRoot, filePath),
          format: 'json_manifest',
        },
        tokenEstimate: estimateTokens(content),
      },
    ];
  },
};
