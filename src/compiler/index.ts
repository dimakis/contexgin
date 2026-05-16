import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokens } from './trimmer.js';
import type { CompileOptions, CompiledContext, ContextSource, ExtractedSection, SerializedNode } from './types.js';
import { discoverAndAdapt, adaptFile } from '../adapter/index.js';
import { TIER_WEIGHTS, type ContextNode, type RankedNode } from '../adapter/types.js';

/**
 * Auto-discover context sources in a workspace.
 * Looks for: CONSTITUTION.md, CLAUDE.md, memory/Profile/*.md, SERVICES.md,
 * and any spoke-level CONSTITUTION.md files.
 */
export async function discoverSources(workspaceRoot: string): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  const root = path.resolve(workspaceRoot);

  // Check for root-level files
  const rootFiles: Array<{ file: string; kind: ContextSource['kind'] }> = [
    { file: 'CONSTITUTION.md', kind: 'constitution' },
    { file: 'CLAUDE.md', kind: 'reference' },
    { file: 'SERVICES.md', kind: 'service' },
  ];

  for (const { file, kind } of rootFiles) {
    const fullPath = path.join(root, file);
    if (await fileExists(fullPath)) {
      sources.push({ path: fullPath, kind, relativePath: file });
    }
  }

  // Check for memory/Profile/*.md
  const profileDir = path.join(root, 'memory', 'Profile');
  if (await dirExists(profileDir)) {
    const profileFiles = await fs.readdir(profileDir);
    for (const file of profileFiles) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(profileDir, file);
        const relativePath = path.join('memory', 'Profile', file);
        sources.push({ path: fullPath, kind: 'profile', relativePath });
      }
    }
  }

  // Check for .cursor/rules/*.mdc
  const cursorRulesDir = path.join(root, '.cursor', 'rules');
  if (await dirExists(cursorRulesDir)) {
    const rulesFiles = await fs.readdir(cursorRulesDir);
    for (const file of rulesFiles) {
      if (file.endsWith('.mdc')) {
        const fullPath = path.join(cursorRulesDir, file);
        const relativePath = path.join('.cursor', 'rules', file);
        sources.push({ path: fullPath, kind: 'reference', relativePath });
      }
    }
  }

  // Check for spoke-level CONSTITUTION.md files (one level deep)
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('node_modules') &&
        entry.name !== 'dist'
      ) {
        const spokeConst = path.join(root, entry.name, 'CONSTITUTION.md');
        if (await fileExists(spokeConst)) {
          sources.push({
            path: spokeConst,
            kind: 'constitution',
            relativePath: path.join(entry.name, 'CONSTITUTION.md'),
          });
        }
      }
    }
  } catch {
    // Directory listing failed — skip spoke discovery
  }

  return sources;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ── Ranking ─────────────────────────────────────────────────────

/** Payload group ordering */
const TYPE_GROUP_ORDER = [
  'governance',
  'structural',
  'operational',
  'identity',
  'reference',
] as const;

const TYPE_GROUP_HEADINGS: Record<string, string> = {
  governance: 'Governance',
  structural: 'Architecture',
  operational: 'Conventions',
  identity: 'Identity',
  reference: 'Reference',
};

/**
 * Rank context nodes by tier weight + optional task boost.
 */
export function rankNodes(nodes: ContextNode[], taskHint?: string): RankedNode[] {
  return nodes
    .map((node) => {
      const weight = TIER_WEIGHTS[node.tier] ?? 0.5;
      const boost = taskHint ? getNodeTaskBoost(node, taskHint) : 0;
      const relevance = Math.min(weight + boost, 1.0);
      const reason = boost > 0 ? `${node.tier} + task boost` : node.tier;
      return { ...node, relevance, reason };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

function getNodeTaskBoost(node: ContextNode, taskHint: string): number {
  const taskTerms = taskHint
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (taskTerms.length === 0) return 0;

  const text = [node.id, node.content].join(' ').toLowerCase();
  let matches = 0;
  for (const term of taskTerms) {
    if (text.includes(term)) matches++;
  }
  return (matches / taskTerms.length) * 0.2;
}

// ── Assembly ────────────────────────────────────────────────────

/**
 * Assemble ranked nodes into a grouped payload.
 * Groups by node type with section headers.
 */
function assembleGroupedPayload(nodes: RankedNode[]): string {
  const groups = new Map<string, RankedNode[]>();

  for (const node of nodes) {
    const existing = groups.get(node.type) ?? [];
    existing.push(node);
    groups.set(node.type, existing);
  }

  const sections: string[] = [];

  for (const type of TYPE_GROUP_ORDER) {
    const group = groups.get(type);
    if (!group || group.length === 0) continue;

    const heading = TYPE_GROUP_HEADINGS[type] || type;
    const content = group.map((n) => renderNodeWithHeading(n)).join('\n\n');
    sections.push(`## ${heading}\n\n${content}`);
  }

  return sections.join('\n\n');
}

/** @internal — exported for testing */
export function nodeNeedsHeading(node: ContextNode | RankedNode): boolean {
  if (/^#{1,6}\s/.test(node.content.trimStart())) return false;
  const hp = node.origin.headingPath;
  return !!(hp && hp.length > 0);
}

/** @internal — exported for testing */
export function renderNodeWithHeading(node: RankedNode): string {
  if (!nodeNeedsHeading(node)) {
    return node.content;
  }
  const sectionTitle = node.origin.headingPath!.slice(-1)[0];
  const qualifier = spokeQualifier(node);
  const heading = qualifier ? `${sectionTitle} (${qualifier})` : sectionTitle;
  return `### ${heading}\n\n${node.content}`;
}

/** @internal — exported for testing */
export function spokeQualifier(node: RankedNode): string | undefined {
  const rel = node.origin.relativePath;
  const parts = rel.split(/[/\\]/);
  if (parts.length < 2) return undefined;
  if (parts[0] === 'memory' && parts[1] === 'Profile') return undefined;
  if (parts[0] === '.cursor') return undefined;
  return parts[0];
}

// ── Trimming ────────────────────────────────────────────────────

export function trimNodesToBudget(
  nodes: RankedNode[],
  budget: number,
): { included: RankedNode[]; trimmed: RankedNode[] } {
  const included: RankedNode[] = [];
  const trimmed: RankedNode[] = [];
  let used = 0;

  // Reserve budget for group heading overhead (## Heading\n\n per unique type)
  const seenTypes = new Set<string>();

  for (const node of nodes) {
    let overhead = 0;
    if (!seenTypes.has(node.type)) {
      const heading = TYPE_GROUP_HEADINGS[node.type] || node.type;
      overhead = estimateTokens(`## ${heading}\n\n`);
    }

    // Per-node heading overhead (### Title (spoke)\n\n) when content doesn't already have one
    let nodeHeadingOverhead = 0;
    if (nodeNeedsHeading(node)) {
      const title = (node.origin.headingPath ?? [node.id]).slice(-1)[0];
      const qualifier = spokeQualifier(node);
      const heading = qualifier ? `### ${title} (${qualifier})\n\n` : `### ${title}\n\n`;
      nodeHeadingOverhead = estimateTokens(heading);
    }

    if (used + node.tokenEstimate + nodeHeadingOverhead + overhead <= budget) {
      if (!seenTypes.has(node.type)) {
        seenTypes.add(node.type);
        used += overhead;
      }
      included.push(node);
      used += node.tokenEstimate + nodeHeadingOverhead;
    } else {
      trimmed.push(node);
    }
  }

  return { included, trimmed };
}

// ── Serialization ───────────────────────────────────────────────

const NODE_TYPE_TO_SOURCE_KIND: Record<string, ContextSource['kind']> = {
  structural: 'constitution',
  operational: 'service',
  identity: 'profile',
  governance: 'constitution',
  reference: 'reference',
};

function nodeToExtractedSection(node: ContextNode): ExtractedSection {
  const headingPath = node.origin.headingPath ?? [node.id];
  return {
    source: {
      path: node.origin.source,
      kind: NODE_TYPE_TO_SOURCE_KIND[node.type] ?? 'reference',
      relativePath: node.origin.relativePath,
    },
    headingPath,
    level: headingPath.length + 1,
    content: node.content,
    tokenEstimate: node.tokenEstimate,
  };
}

function nodeToSerialized(node: ContextNode): SerializedNode {
  return {
    id: node.id,
    type: node.type,
    tier: node.tier,
    content: node.content,
    origin: {
      source: node.origin.source,
      relativePath: node.origin.relativePath,
      format: node.origin.format,
      ...(node.origin.headingPath ? { headingPath: node.origin.headingPath } : {}),
    },
    tokenEstimate: node.tokenEstimate,
  };
}

// ── Compile ─────────────────────────────────────────────────────

/**
 * Compile context for a workspace.
 * Format-aware parsing → typed nodes → rank → trim → grouped payload.
 */
export async function compile(options: CompileOptions): Promise<CompiledContext> {
  const { workspaceRoot, tokenBudget, taskHint } = options;

  // Step 1: Discover and adapt all sources
  let allNodes: ContextNode[];
  if (options.sources) {
    const nodeArrays = await Promise.all(
      options.sources.map((s) => adaptFile(s.path, workspaceRoot)),
    );
    allNodes = nodeArrays.flat();
  } else {
    allNodes = await discoverAndAdapt(workspaceRoot);
  }

  // Step 2: Rank
  const ranked = rankNodes(allNodes, taskHint);

  // Step 3: Filter excluded (case-insensitive, match heading path prefix OR node ID)
  const filtered = options.excluded
    ? ranked.filter(
        (n) =>
          !options.excluded!.some((excl) => {
            // Single-element exclusion: also check node ID (case-insensitive)
            if (excl.length === 1 && n.id.toLowerCase() === excl[0].toLowerCase()) return true;
            const hp = n.origin.headingPath ?? [n.id];
            return (
              excl.length <= hp.length &&
              excl.every((seg, i) => hp[i].toLowerCase() === seg.toLowerCase())
            );
          }),
      )
    : ranked;

  // Step 4: Trim to budget
  const { included, trimmed } = trimNodesToBudget(filtered, tokenBudget);

  // Step 5: Assemble grouped payload
  const bootPayload = assembleGroupedPayload(included);
  const navigationHints = included.map((n) => (n.origin.headingPath ?? [n.id]).join(' > '));

  // Build sources list from included nodes only (after exclusion + trimming)
  const sourceSet = new Set<string>();
  const sources: ContextSource[] = [];
  for (const node of included) {
    if (!sourceSet.has(node.origin.source)) {
      sourceSet.add(node.origin.source);
      sources.push({
        path: node.origin.source,
        kind: 'reference',
        relativePath: node.origin.relativePath,
      });
    }
  }

  return {
    bootPayload,
    contextBlocks: new Map(),
    navigationHints,
    bootTokens: estimateTokens(bootPayload),
    sources,
    included: included.map(nodeToExtractedSection),
    trimmed: trimmed.map(nodeToExtractedSection),
    nodes: included.map(nodeToSerialized),
    trimmedNodes: trimmed.map(nodeToSerialized),
  };
}

// Re-exports
export { parseMarkdown, stripFrontmatter } from './parser.js';
export type { HeadingNode } from './parser.js';
export { extractSection, extractAllLevel2, cleanContent } from './extractor.js';
export { rankSections } from './ranker.js';
export { estimateTokens, trimToBudget } from './trimmer.js';
export * from './types.js';
