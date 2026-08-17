/**
 * Workflow adapter — handles state machine definitions.
 * Matches: workflows/*.yaml, workflows/*.yml, context/workflow.md
 *
 * YAML files are parsed as FSM definitions (states, transitions, stale
 * thresholds, entry criteria). Markdown files are parsed as section-based
 * workflow documentation. Both produce operational-tier ContextNodes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseMarkdown, stripFrontmatter } from '../compiler/parser.js';
import { extractAllLevel2, cleanContent } from '../compiler/extractor.js';
import { estimateTokens } from '../compiler/trimmer.js';
import type { ContextAdapter, ContextNode } from './types.js';
import { slugify } from './types.js';

// ── YAML Schema ────────────────────────────────────────────────

interface WorkflowState {
  description?: string;
  owner?: string;
  entry_criteria?: string[];
  stale_after?: string;
  terminal?: boolean;
}

interface WorkflowTransition {
  from: string;
  to: string;
  trigger?: string;
}

interface WorkflowDefinition {
  name?: string;
  description?: string;
  states?: Record<string, WorkflowState>;
  transitions?: WorkflowTransition[];
}

// ── Path matching ──────────────────────────────────────────────

/** Normalise to forward slashes for cross-platform matching */
function normalise(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isWorkflowYaml(filePath: string): boolean {
  const norm = normalise(filePath);
  return /(^|\/)workflows\/[^/]+\.ya?ml$/.test(norm);
}

function isWorkflowMd(filePath: string): boolean {
  const norm = normalise(filePath);
  return norm.endsWith('/context/workflow.md') || norm === 'context/workflow.md';
}

// ── YAML → ContextNodes ────────────────────────────────────────

function renderStatesContent(states: Record<string, WorkflowState>): string {
  const lines: string[] = [];
  for (const [name, state] of Object.entries(states)) {
    if (!state || typeof state !== 'object') continue;
    const parts = [`- **${name}**`];
    if (state.description) parts.push(`— ${state.description}`);
    if (state.owner) parts.push(`(owner: ${state.owner})`);
    if (state.stale_after) parts.push(`[stale_after: ${state.stale_after}]`);
    if (state.terminal) parts.push(`[terminal]`);
    lines.push(parts.join(' '));

    if (state.entry_criteria && state.entry_criteria.length > 0) {
      for (const criterion of state.entry_criteria) {
        lines.push(`  - ${criterion}`);
      }
    }
  }
  return lines.join('\n');
}

function renderTransitionsContent(transitions: WorkflowTransition[]): string {
  return transitions
    .map((t) => {
      const trigger = t.trigger ? ` [${t.trigger}]` : '';
      return `- ${t.from} → ${t.to}${trigger}`;
    })
    .join('\n');
}

function adaptYaml(filePath: string, workspaceRoot: string, raw: string): ContextNode[] {
  const def = parseYaml(raw) as WorkflowDefinition;
  if (!def || typeof def !== 'object') return [];

  const relativePath = path.relative(workspaceRoot, filePath);
  const workflowName = def.name || path.basename(filePath, path.extname(filePath));
  const nameSlug = slugify(`workflow-${workflowName}`);
  const nodes: ContextNode[] = [];

  const origin = (headingPath: string[]) => ({
    source: filePath,
    relativePath,
    format: 'workflow' as const,
    headingPath,
  });

  // Overview node
  const overviewParts: string[] = [`**${workflowName}**`];
  if (def.description) overviewParts.push(def.description);
  if (def.states) {
    const stateNames = Object.keys(def.states);
    overviewParts.push(`States: ${stateNames.join(', ')}`);
  }
  if (def.transitions) {
    overviewParts.push(`Transitions: ${def.transitions.length}`);
  }
  const overviewContent = overviewParts.join('\n');
  nodes.push({
    id: `${nameSlug}-overview`,
    type: 'operational',
    tier: 'operational',
    content: overviewContent,
    origin: origin([workflowName, 'Overview']),
    tokenEstimate: estimateTokens(overviewContent),
  });

  // States node
  if (def.states && Object.keys(def.states).length > 0) {
    const statesContent = renderStatesContent(def.states);
    nodes.push({
      id: `${nameSlug}-states`,
      type: 'operational',
      tier: 'operational',
      content: statesContent,
      origin: origin([workflowName, 'States']),
      tokenEstimate: estimateTokens(statesContent),
    });
  }

  // Transitions node
  if (def.transitions && def.transitions.length > 0) {
    const transContent = renderTransitionsContent(def.transitions);
    nodes.push({
      id: `${nameSlug}-transitions`,
      type: 'operational',
      tier: 'operational',
      content: transContent,
      origin: origin([workflowName, 'Transitions']),
      tokenEstimate: estimateTokens(transContent),
    });
  }

  return nodes;
}

// ── Markdown → ContextNodes ────────────────────────────────────

async function adaptMarkdown(
  filePath: string,
  workspaceRoot: string,
  raw: string,
): Promise<ContextNode[]> {
  const content = stripFrontmatter(raw);
  const nodes = parseMarkdown(content);
  const sections = extractAllLevel2(nodes, {
    path: filePath,
    kind: 'reference',
    relativePath: path.relative(workspaceRoot, filePath),
  });

  return sections.map((section) => {
    const cleaned = cleanContent(section.content);
    const lastHeading = section.headingPath[section.headingPath.length - 1];

    return {
      id: slugify(`workflow-${lastHeading}`),
      type: 'operational' as const,
      tier: 'operational' as const,
      content: cleaned,
      origin: {
        source: filePath,
        relativePath: path.relative(workspaceRoot, filePath),
        format: 'workflow' as const,
        headingPath: section.headingPath,
      },
      tokenEstimate: estimateTokens(cleaned),
    };
  });
}

// ── Adapter ────────────────────────────────────────────────────

export const workflowAdapter: ContextAdapter = {
  format: 'workflow',

  canHandle(filePath: string): boolean {
    return isWorkflowYaml(filePath) || isWorkflowMd(filePath);
  },

  async adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]> {
    const raw = await fs.readFile(filePath, 'utf-8');

    if (isWorkflowYaml(filePath)) {
      return adaptYaml(filePath, workspaceRoot, raw);
    }

    return adaptMarkdown(filePath, workspaceRoot, raw);
  },
};
