import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdown, stripFrontmatter } from './parser.js';
import { extractAllLevel2, cleanContent } from './extractor.js';
import { rankSections } from './ranker.js';
import { trimToBudget, estimateTokens } from './trimmer.js';
import type { CompileOptions, CompiledContext, ContextSource, SerializedNode } from './types.js';
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

/**
 * Compile context for a workspace.
 *
 * 1. Discover or use provided source files
 * 2. Parse each source into heading tree
 * 3. Extract configured sections
 * 4. Rank by relevance (optionally task-aware)
 * 5. Trim to token budget
 * 6. Assemble into CompiledContext
 */
export async function compile(options: CompileOptions): Promise<CompiledContext> {
  const { workspaceRoot, tokenBudget, taskHint } = options;

  // Step 1: Discover sources
  const sources = options.sources ?? (await discoverSources(workspaceRoot));

  // Step 2 & 3: Parse and extract sections from each source
  const allSections = [];

  for (const source of sources) {
    try {
      const raw = await fs.readFile(source.path, 'utf-8');
      const content = stripFrontmatter(raw);
      const nodes = parseMarkdown(content);
      const sections = extractAllLevel2(nodes, source);

      // Clean content and account for heading overhead in token estimate
      for (const section of sections) {
        section.content = cleanContent(section.content);
        // Include heading markup + separator overhead (~2 newlines + heading chars)
        const headingOverhead = section.headingPath[section.headingPath.length - 1].length + 10;
        section.tokenEstimate =
          estimateTokens(section.content) + estimateTokens(' '.repeat(headingOverhead));
      }

      allSections.push(...sections);
    } catch {
      // Skip files that can't be read
    }
  }

  // Step 4: Rank
  const ranked = rankSections(allSections, { taskHint });

  // Filter excluded sections
  const filtered = options.excluded
    ? ranked.filter(
        (s) =>
          !options.excluded!.some(
            (excl) =>
              excl.length <= s.headingPath.length &&
              excl.every((seg, i) => s.headingPath[i] === seg),
          ),
      )
    : ranked;

  // Step 5: Trim to budget
  const { included, trimmed } = trimToBudget(filtered, tokenBudget);

  // Step 6: Assemble
  const bootPayload = included
    .map((s) => {
      const heading = '#'.repeat(s.level) + ' ' + s.headingPath[s.headingPath.length - 1];
      return heading + '\n\n' + s.content;
    })
    .join('\n\n');

  const navigationHints = included.map((s) => s.headingPath.join(' > '));

  return {
    bootPayload,
    contextBlocks: new Map(),
    navigationHints,
    bootTokens: estimateTokens(bootPayload),
    sources,
    trimmed,
  };
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

// ── Adapter-based compilation ───────────────────────────────────

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
function rankNodes(nodes: ContextNode[], taskHint?: string): RankedNode[] {
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
    const content = group.map((n) => n.content).join('\n\n');
    sections.push(`## ${heading}\n\n${content}`);
  }

  return sections.join('\n\n');
}

function trimNodesToBudget(
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

    if (used + node.tokenEstimate + overhead <= budget) {
      if (!seenTypes.has(node.type)) {
        seenTypes.add(node.type);
        used += overhead;
      }
      included.push(node);
      used += node.tokenEstimate;
    } else {
      trimmed.push(node);
    }
  }

  return { included, trimmed };
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

/**
 * Compile context using the adapter pipeline.
 * Format-aware parsing → typed nodes → rank → trim → grouped payload.
 */
export async function compileWithAdapters(options: CompileOptions): Promise<CompiledContext> {
  const { workspaceRoot, tokenBudget, taskHint } = options;

  // Step 1: Discover and adapt all sources
  // Respect options.sources if provided (same contract as compile())
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

  // Step 3: Filter excluded (match by heading path prefix OR single-element match against node ID)
  const filtered = options.excluded
    ? ranked.filter(
        (n) =>
          !options.excluded!.some((excl) => {
            // Single-element exclusion: also check node ID
            if (excl.length === 1 && n.id === excl[0]) return true;
            const hp = n.origin.headingPath ?? [n.id];
            return excl.length <= hp.length && excl.every((seg, i) => hp[i] === seg);
          }),
      )
    : ranked;

  // Step 4: Trim to budget
  const { included, trimmed } = trimNodesToBudget(filtered, tokenBudget);

  // Step 5: Assemble grouped payload
  const bootPayload = assembleGroupedPayload(included);
  const navigationHints = included.map((n) => (n.origin.headingPath ?? [n.id]).join(' > '));

  // Build sources list for backwards compat
  const sourceSet = new Set<string>();
  const sources: ContextSource[] = [];
  for (const node of allNodes) {
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
    trimmed: [], // ExtractedSection[] — empty for adapter pipeline (legacy field)
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
