import * as path from 'node:path';

// ── Context Node ────────────────────────────────────────────────

/** The type of context a node represents */
export type ContextNodeType =
  | 'structural' // Architecture, topology, what exists where
  | 'operational' // How to work in this repo
  | 'identity' // Who/what this workspace is
  | 'governance' // What must/must not happen
  | 'reference'; // Pointers to other resources

/** Relevance tier for ranking — maps to existing compiler tiers */
export type ContextTier =
  | 'constitutional' // 1.0 — purpose, principles, boundaries
  | 'navigational' // 0.8 — architecture, entry points
  | 'operational' // 0.75 — knowledge store, operating manuals
  | 'identity' // 0.7 — profile, communication style
  | 'reference' // 0.5 — services, memory
  | 'historical'; // 0.3 — session notes, old decisions

/** The source format a node was parsed from */
export type SourceFormat =
  | 'claude_md'
  | 'cursor_rules'
  | 'constitution'
  | 'entity'
  | 'knowledge'
  | 'markdown';

/** Where a context node originated */
export interface NodeOrigin {
  /** Absolute path or URI */
  source: string;
  /** Relative path within workspace */
  relativePath: string;
  /** Source format */
  format: SourceFormat;
  /** Heading path if applicable (e.g. ["Git Discipline", "Conventional Commits"]) */
  headingPath?: string[];
}

/**
 * A typed unit of context, normalized from any source format.
 * Replaces ExtractedSection as the compiler's internal unit.
 */
export interface ContextNode {
  /** Unique ID within the source (e.g. "git-discipline", "spoke:command_center") */
  id: string;
  /** What kind of context this is */
  type: ContextNodeType;
  /** Relevance tier for ranking */
  tier: ContextTier;
  /** The actual context content (markdown) */
  content: string;
  /** Where this came from */
  origin: NodeOrigin;
  /** Approximate token count */
  tokenEstimate: number;
}

/** A context node with a computed relevance score, ready for trimming */
export interface RankedNode extends ContextNode {
  /** Relevance score (0-1) */
  relevance: number;
  /** Why this was ranked this way */
  reason: string;
}

// ── Adapter Interface ───────────────────────────────────────────

/**
 * A context adapter: parses a specific source format into typed context nodes.
 * Pure function contract — file in, nodes out. No side effects, no state.
 */
export interface ContextAdapter {
  /** Which source format this adapter handles */
  format: SourceFormat;

  /** Whether this adapter can handle the given file path */
  canHandle(filePath: string): boolean;

  /** Parse + classify + normalize a source file into context nodes */
  adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]>;
}

// ── Tier Weights ────────────────────────────────────────────────

/** Numeric weights for each tier — used by ranker */
export const TIER_WEIGHTS: Record<ContextTier, number> = {
  constitutional: 1.0,
  navigational: 0.8,
  operational: 0.75,
  identity: 0.7,
  reference: 0.5,
  historical: 0.3,
};

// ── Helpers ─────────────────────────────────────────────────────

/** Whether a relative path is nested below the workspace root (has path separators). */
export function isNestedPath(relativePath: string): boolean {
  return relativePath.includes(path.sep) || relativePath.includes('/');
}

/** Whether a relative path points to a memory/Profile file. */
export function isProfilePath(relativePath: string): boolean {
  return relativePath.startsWith('memory/Profile/') || relativePath.startsWith('memory\\Profile\\');
}

/** Slugify a heading into a node ID */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Node-to-Source Conversion ──────────────────────────────────

/**
 * Map a ContextNode's origin to the appropriate ContextSource kind.
 * Used by both the deprecated discoverSources wrapper and nodesToSources.
 */
export function nodeToSourceKind(
  node: ContextNode,
): 'constitution' | 'profile' | 'service' | 'reference' {
  const { format, relativePath } = node.origin;
  const basename = path.basename(relativePath);

  if (format === 'constitution') return 'constitution';
  if (format === 'markdown' && isProfilePath(relativePath)) return 'profile';
  if (basename === 'SERVICES.md') return 'service';
  // claude_md, cursor_rules, knowledge, and other markdown → reference
  return 'reference';
}

/**
 * Convert ContextNode[] to ContextSource[].
 * Deduplicates by source path since multiple nodes may come from one file.
 * Preserves kind information from the node's origin format.
 */
export function nodesToSources(nodes: ContextNode[]): Array<{
  path: string;
  kind: 'constitution' | 'profile' | 'memory' | 'service' | 'reference';
  relativePath: string;
}> {
  const seen = new Set<string>();
  const sources: Array<{
    path: string;
    kind: 'constitution' | 'profile' | 'memory' | 'service' | 'reference';
    relativePath: string;
  }> = [];
  for (const node of nodes) {
    if (!seen.has(node.origin.source)) {
      seen.add(node.origin.source);
      sources.push({
        path: node.origin.source,
        kind: nodeToSourceKind(node),
        relativePath: node.origin.relativePath,
      });
    }
  }
  return sources;
}
