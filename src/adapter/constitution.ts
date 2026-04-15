/**
 * Constitution adapter — wraps graph/parser output as typed context nodes.
 * Reuses parseConstitution() — no duplicate parsing logic.
 */

import * as path from 'node:path';
import { parseConstitution } from '../graph/parser.js';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';

export const constitutionAdapter: ContextAdapter = {
  format: 'constitution',

  canHandle(filePath: string): boolean {
    return path.basename(filePath) === 'CONSTITUTION.md';
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const relativePath = path.relative(workspaceRoot, filePath);
    const constitution = await parseConstitution(filePath);
    const nodes: ContextNode[] = [];

    const origin = (headingPath?: string[]) => ({
      source: filePath,
      relativePath,
      format: 'constitution' as const,
      ...(headingPath ? { headingPath } : {}),
    });

    // Purpose → identity / constitutional
    if (constitution.purpose) {
      nodes.push({
        id: 'purpose',
        type: 'identity',
        tier: 'constitutional',
        content: constitution.purpose,
        origin: origin(['Purpose']),
        tokenEstimate: estimateTokens(constitution.purpose),
      });
    }

    // Directory semantics → structural / navigational
    if (constitution.tree.length > 0) {
      const treeContent = constitution.tree
        .map((n) => `- \`${n.path}\` — ${n.description || n.name}`)
        .join('\n');
      nodes.push({
        id: 'directory-semantics',
        type: 'structural',
        tier: 'navigational',
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
        tier: 'navigational',
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
        tier: 'navigational',
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
        tier: 'constitutional',
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
        tier: 'constitutional',
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
        tier: 'navigational',
        content: spokeContent,
        origin: origin(['Spoke Charters']),
        tokenEstimate: estimateTokens(spokeContent),
      });
    }

    return nodes;
  },
};
