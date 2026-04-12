/** A testable claim extracted from a context file */
export interface Claim {
  /** Source file containing the claim */
  source: string;
  /** What is being claimed */
  assertion: string;
  /** Type of claim determines validation strategy */
  kind: ClaimKind;
  /** The specific value to validate (path, name, etc.) */
  target: string;
  /** Line number in source file */
  line: number;
}

/** All possible claim kinds */
export type ClaimKind =
  | 'file_exists'
  | 'directory_exists'
  | 'entry_point'
  | 'boundary'
  | 'structural'
  | 'tree_structure'
  | 'external_exists'
  | 'count_matches'
  | 'list_complete';

/** Result of validating a claim */
export interface ClaimResult {
  claim: Claim;
  valid: boolean;
  /** What was actually found (if different from claimed) */
  actual?: string;
  /** Human-readable explanation */
  message: string;
}

/** A tree structure claim with its declared tree attached */
export interface TreeStructureClaim extends Claim {
  kind: 'tree_structure';
  declaredTree: import('./tree-parser.js').DeclaredNode[];
}

/** Result of tree structure validation, includes the full diff */
export interface TreeClaimResult extends ClaimResult {
  diff?: import('./tree-diff.js').TreeDiffResult;
}

// ── Doc Consistency Types ────────────────────────────────────────

/** A documentation contract declared in CONSTITUTION.md */
export interface DocContract {
  /** Relative path to the document (e.g. "README.md") */
  document: string;
  /** Optional heading path (e.g. "API" or "Agents") */
  section?: string;
  /** What type of claim to check */
  claim: 'count' | 'list_complete';
  /** How to verify the claim */
  verification: {
    strategy: 'glob' | 'grep';
    pattern: string;
    /** Search root relative to workspace, defaults to "." */
    path?: string;
  };
}

/** A count claim with the expected count attached */
export interface CountClaim extends Claim {
  kind: 'count_matches';
  /** The expected count from the documentation */
  expectedCount: number;
  /** The noun being counted (e.g. "modules", "agents") */
  noun: string;
  /** How to find matching files: glob or grep */
  strategy: 'glob' | 'grep';
  /** Sub-root to search within (relative to workspace root) */
  searchPath?: string;
}

/** A list completeness claim with the listed items attached */
export interface ListClaim extends Claim {
  kind: 'list_complete';
  /** Items listed in the documentation */
  listedItems: string[];
  /** How to find matching files: glob or grep */
  strategy: 'glob' | 'grep';
  /** Sub-root to search within (relative to workspace root) */
  searchPath?: string;
}

/** A drift report for a workspace */
export interface DriftReport {
  /** When this report was generated */
  timestamp: Date;
  /** Workspace root */
  workspaceRoot: string;
  /** All claims checked */
  results: ClaimResult[];
  /** Only the invalid claims */
  drift: ClaimResult[];
  /** Summary statistics */
  summary: {
    total: number;
    valid: number;
    invalid: number;
    byKind: Record<string, { total: number; invalid: number }>;
  };
}
