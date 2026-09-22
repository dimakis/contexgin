/** Canonical instructions are indivisible: preserve every line, without import expansion. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter } from './types.js';

export const agentsAdapter: ContextAdapter = {
  format: 'agents_md',
  canHandle: (filePath) => path.basename(filePath) === 'AGENTS.md',
  async adapt(filePath, workspaceRoot) {
    const root = await fs.realpath(workspaceRoot);
    const resolved = path.resolve(filePath);
    const relative = path.relative(path.resolve(workspaceRoot), resolved);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('AGENTS.md must be inside the workspace');
    }
    // Reject links in any component, including links that remain inside the workspace.
    let current = path.resolve(workspaceRoot);
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component);
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`AGENTS.md symlink is unsupported: ${relative}`);
      }
    }
    const real = await fs.realpath(resolved);
    if (!real.startsWith(root + path.sep)) throw new Error('AGENTS.md escapes workspace');
    const content = (await fs.readFile(resolved, 'utf8')).trim();
    if (!content) throw new Error(`Canonical instructions are empty: ${relative}`);
    return [
      {
        id: 'agent-instructions',
        type: 'governance',
        tier: 'constitutional',
        content,
        required: true,
        origin: {
          source: resolved,
          relativePath: relative,
          format: 'agents_md',
          headingPath: ['Agent instructions'],
        },
        tokenEstimate: estimateTokens(content),
      },
    ];
  },
};
