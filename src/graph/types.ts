// ── Core Node Types ──────────────────────────────────────────────

/** Top-level workspace containing spokes and a root constitution */
export interface Hub {
  /** Derived from absolute path */
  id: string;
  /** Absolute filesystem path */
  path: string;
  /** Directory basename */
  name: string;
  /** Parsed root constitution */
  constitution: Constitution;
  /** Child spokes declared in constitution */
  spokes: Spoke[];
  /** Unresolved external references to other hubs */
  externals: ExternalRef[];
}

/** Bounded context within a hub */
export interface Spoke {
  /** Unique identifier: hubId/spokeName */
  id: string;
  /** Directory name */
  name: string;
  /** Absolute path */
  path: string;
  /** Relative to parent hub root */
  relativePath: string;
  /** Parent hub or spoke id */
  parentId: string;
  /** Parsed spoke constitution (null if missing — violation recorded) */
  constitution: Constitution | null;
  /** Nested sub-spokes (max 1 level deep) */
  children: Spoke[];
  /** Confidentiality level */
  confidentiality: ConfidentialityLevel;
  /** Who this spoke is for */
  audience?: string;
  /** How it's governed */
  governance?: string;
}

export type ConfidentialityLevel = 'none' | 'soft' | 'hard';

/** Parsed structural contract from a CONSTITUTION.md file */
export interface Constitution {
  /** Absolute path to the source file */
  sourcePath: string;
  /** Extracted from ## Purpose section */
  purpose: string;
  /** Directory semantics table → declared filesystem structure */
  tree: DeclaredNode[];
  /** Executable commands/scripts */
  entryPoints: EntryPoint[];
  /** Typed edges to other spokes/hubs */
  dependencies: Dependency[];
  /** Confidentiality and access declarations */
  boundaries: Boundary[];
  /** Governance principles (extracted from ## Principles or similar) */
  principles: string[];
  /** Spoke charters declared in this constitution (hub-level only) */
  spokeDeclarations: SpokeDeclaration[];
}

/** A node declared in a constitution's directory semantics table */
export interface DeclaredNode {
  /** Relative path, e.g. "src/compiler/" */
  path: string;
  /** Basename */
  name: string;
  /** File or directory */
  type: 'file' | 'directory';
  /** Description from table cell */
  description?: string;
}

/** Raw spoke declaration from a hub constitution's charters table */
export interface SpokeDeclaration {
  /** Spoke directory name */
  name: string;
  /** Brief purpose/description */
  purpose: string;
  /** Governance model */
  governance?: string;
  /** Confidentiality level */
  confidentiality: ConfidentialityLevel;
  /** Audience */
  audience?: string;
}

// ── Edge Types ───────────────────────────────────────────────────

/** Typed directional relationship between graph nodes */
export interface Dependency {
  /** Source node id (spoke or hub) */
  from: string;
  /** Target node id (spoke or hub) */
  to: string;
  /** Relationship semantics */
  kind: DependencyKind;
  /** Why this dependency exists */
  description?: string;
}

export type DependencyKind =
  | 'contains' // parent → child (hub → spoke)
  | 'depends_on' // reads from, requires
  | 'external' // reference to another hub
  | 'produces_for' // output flows to
  | 'reads_from' // input comes from
  | 'governed_by'; // governance relationship

// ── Constraint Types ─────────────────────────────────────────────

/** Confidentiality or access control declaration */
export interface Boundary {
  /** Which spoke this applies to */
  spokeId: string;
  /** Restriction level */
  level: ConfidentialityLevel;
  /** What this boundary means */
  description: string;
  /** Agent types or contexts that can't access this spoke */
  excludedFrom: string[];
}

/** Executable command or script declared in a constitution */
export interface EntryPoint {
  /** Display name */
  name: string;
  /** The actual command (may include args) */
  command: string;
  /** What it does */
  description: string;
  /** Which spoke/hub declares it */
  sourceId: string;
}

/** Unresolved external reference to another hub */
export interface ExternalRef {
  /** Absolute or ~-prefixed path */
  path: string;
  /** Description from constitution */
  description?: string;
}

// ── Output Types ─────────────────────────────────────────────────

/** Detected drift between declared structure and observed reality */
export interface Violation {
  /** What kind of violation */
  kind: ViolationKind;
  /** How severe */
  severity: ViolationSeverity;
  /** Where in the graph (spoke path, hub, edge) */
  location: string;
  /** What the constitution declares */
  declared: string;
  /** What reality shows */
  actual: string;
  /** Which constitution file declared it */
  source: string;
  /** Human-readable explanation */
  message: string;
  /** How to fix it */
  suggestion?: string;
}

export type ViolationKind =
  | 'missing_directory' // declared dir doesn't exist
  | 'missing_file' // declared file doesn't exist
  | 'undeclared_directory' // dir exists but not in any constitution
  | 'missing_constitution' // spoke dir exists but no CONSTITUTION.md
  | 'stale_reference' // constitution references something removed
  | 'broken_dependency' // dependency target doesn't exist
  | 'missing_external' // [external] hub not found
  | 'boundary_violation' // content leaks across hard boundary
  | 'nesting_depth'; // spoke nesting exceeds 2 levels

export type ViolationSeverity = 'error' | 'warning' | 'info';

// ── Composite Types ──────────────────────────────────────────────

/** Complete structural graph for one or more hubs */
export interface HubGraph {
  /** All hubs in the graph */
  hubs: Hub[];
  /** All dependency edges (including cross-hub when resolved) */
  edges: Dependency[];
  /** All violations detected during construction */
  violations: Violation[];
}

/** Result of resolving a reference against the graph */
export interface ResolvedPath {
  /** Absolute filesystem path */
  absolutePath: string;
  /** The spoke or hub it resolved to */
  resolvedIn: string;
  /** How it was resolved */
  resolution: 'child' | 'sibling' | 'hub_root' | 'external';
}

// ── All ViolationKind values (for exhaustiveness checks) ─────────

export const VIOLATION_KINDS: readonly ViolationKind[] = [
  'missing_directory',
  'missing_file',
  'undeclared_directory',
  'missing_constitution',
  'stale_reference',
  'broken_dependency',
  'missing_external',
  'boundary_violation',
  'nesting_depth',
] as const;
