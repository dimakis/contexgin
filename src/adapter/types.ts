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
  | 'identity' // 0.7 — profile, communication style
  | 'reference' // 0.5 — services, memory
  | 'historical'; // 0.3 — session notes, old decisions

/** The source format a node was parsed from */
export type SourceFormat = 'claude_md' | 'cursor_rules' | 'constitution' | 'markdown';

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
  identity: 0.7,
  reference: 0.5,
  historical: 0.3,
};

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Whether a relative path represents a spoke (not at the workspace root).
 * Checks both OS-native separator and forward slash for cross-platform safety.
 */
export function isSpoke(relativePath: string): boolean {
  return relativePath.includes(path.sep) || relativePath.includes('/');
}

/** Slugify a heading into a node ID */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
