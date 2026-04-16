/**
 * Constitution adapter — wraps graph/parser output as typed context nodes.
 * Reuses parseConstitution() — no duplicate parsing logic.
 */

import * as path from 'node:path';
import { parseConstitution } from '../graph/parser.js';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode, ContextTier } from './types.js';

/** Whether this constitution is a spoke (not the workspace root) */
function isSpoke(relativePath: string): boolean {
  return relativePath.includes(path.sep) || relativePath.includes('/');
}

/**
 * Demote spoke constitutions — they're context, not instructions.
 * Root constitutional → 1.0, spoke → 0.65
 * Root navigational  → 0.8, spoke → 0.45
 */
function tierForDepth(baseTier: ContextTier, spoke: boolean): ContextTier {
  if (!spoke) return baseTier;
  // Spokes get demoted: constitutional → reference, navigational → historical
  if (baseTier === 'constitutional') return 'reference';
  return 'historical';
}

export const constitutionAdapter: ContextAdapter = {
  format: 'constitution',

  canHandle(filePath: string): boolean {
    return path.basename(filePath) === 'CONSTITUTION.md';
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const relativePath = path.relative(workspaceRoot, filePath);
    const constitution = await parseConstitution(filePath);
    const nodes: ContextNode[] = [];
    const spoke = isSpoke(relativePath);

    const origin = (headingPath?: string[]) => ({
      source: filePath,
      relativePath,
      format: 'constitution' as const,
      ...(headingPath ? { headingPath } : {}),
    });

    // Purpose → identity / constitutional (or reference for spokes)
    if (constitution.purpose) {
      nodes.push({
        id: 'purpose',
        type: 'identity',
        tier: tierForDepth('constitutional', spoke),
        content: constitution.purpose,
        origin: origin(['Purpose']),
        tokenEstimate: estimateTokens(constitution.purpose),
      });
    }

    // Directory semantics → structural / navigational (or historical for spokes)
    if (constitution.tree.length > 0) {
      const treeContent = constitution.tree
        .map((n) => `- \`${n.path}\` — ${n.description || n.name}`)
        .join('\n');
      nodes.push({
        id: 'directory-semantics',
        type: 'structural',
        tier: tierForDepth('navigational', spoke),
        content: treeContent,
        origin: origin(['Directory Semantics']),
        tokenEstimate: estimateTokens(treeContent),
      });
    }

    // Entry points → operational / navigational
    if (constitution.entryPoints.length > 0) {
      const epContent = constitution.entryPoints
        .map((ep) => `- \`${ep.command}\` — ${ep.description}`)
        .join('\n');
      nodes.push({
        id: 'entry-points',
        type: 'operational',
        tier: tierForDepth('navigational', spoke),
        content: epContent,
        origin: origin(['Entry Points']),
        tokenEstimate: estimateTokens(epContent),
      });
    }

    // Dependencies → structural / navigational
    if (constitution.dependencies.length > 0) {
      const depContent = constitution.dependencies
        .map((d) => `- ${d.to}${d.description ? ` — ${d.description}` : ''}`)
        .join('\n');
      nodes.push({
        id: 'dependencies',
        type: 'structural',
        tier: tierForDepth('navigational', spoke),
        content: depContent,
        origin: origin(['Dependencies']),
        tokenEstimate: estimateTokens(depContent),
      });
    }

    // Boundaries → governance / constitutional
    if (constitution.boundaries.length > 0) {
      const boundContent = constitution.boundaries
        .map((b) => `- [${b.level}] ${b.description}`)
        .join('\n');
      nodes.push({
        id: 'boundaries',
        type: 'governance',
        tier: tierForDepth('constitutional', spoke),
        content: boundContent,
        origin: origin(['Boundaries']),
        tokenEstimate: estimateTokens(boundContent),
      });
    }

    // Principles → governance / constitutional
    if (constitution.principles.length > 0) {
      const prinContent = constitution.principles.map((p) => `- ${p}`).join('\n');
      nodes.push({
        id: 'principles',
        type: 'governance',
        tier: tierForDepth('constitutional', spoke),
        content: prinContent,
        origin: origin(['Principles']),
        tokenEstimate: estimateTokens(prinContent),
      });
    }

    // Spoke declarations → structural / navigational
    if (constitution.spokeDeclarations.length > 0) {
      const spokeContent = constitution.spokeDeclarations
        .map((s) => `- \`${s.name}/\` — ${s.purpose}`)
        .join('\n');
      nodes.push({
        id: 'spoke-charters',
        type: 'structural',
        tier: tierForDepth('navigational', spoke),
        content: spokeContent,
        origin: origin(['Spoke Charters']),
        tokenEstimate: estimateTokens(spokeContent),
      });
    }

    return nodes;
  },
};
