// ── Schema Registry Primitives ──────────────────────────────────
//
// Core types for the universal schema registry. These extend the
// existing integrity types (Claim, ClaimResult, DriftReport) with
// schema identity, versioning, compatibility, and watch configuration.

/** How schema evolution is governed */
export type CompatibilityMode = 'backward' | 'forward' | 'full' | 'none';

/** How severe a declaration violation is */
export type DeclarationSeverity = 'error' | 'warning' | 'info';

/** How often validation runs */
export type WatchMode = 'continuous' | 'periodic' | 'manual';

// ── Core Primitives ────────────────────────────────────────────

/**
 * A registered schema describing the expected shape of a system.
 *
 * Schemas are the unit of registration. Each provider discovers and
 * extracts one or more schemas from its domain (workspace structure,
 * memory vault, service health, etc.).
 */
export interface Schema {
  /** Unique identifier (e.g., 'workspace:mgmt', 'memory-vault') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semver version string */
  version: string;
  /** How evolution is governed */
  compatibility: CompatibilityMode;
  /** Which provider registered this schema */
  provider: string;
  /** What the schema declares about reality */
  declarations: Declaration[];
  /** How and when to revalidate */
  watchConfig: WatchConfig;
  /** When this schema was first registered */
  registeredAt?: Date;
  /** When this schema was last updated */
  updatedAt?: Date;
}

/**
 * A single testable assertion within a schema.
 *
 * Declarations are the atomic unit of drift detection. Each one
 * says "this thing should be true" and can be validated independently.
 */
export interface Declaration {
  /** Extensible kind string — determines which validator handles it.
   *  Built-in: 'file_exists', 'directory_exists', 'tree_structure',
   *  'entry_point', 'external_reference'. Providers add their own. */
  kind: string;
  /** What's being declared about (path, URL, identifier) */
  target: string;
  /** How serious a violation of this declaration is */
  severity: DeclarationSeverity;
  /** Kind-specific properties (e.g., maxAgeDays, required fields) */
  metadata?: Record<string, unknown>;
  /** Human-readable description of what's being declared */
  description?: string;
}

/**
 * A function that validates a single declaration against reality.
 *
 * Validators are registered by kind. When the registry validates a schema,
 * it matches each declaration's kind to a registered validator.
 */
export interface Validator {
  /** Which declaration kind this validator handles */
  kind: string;
  /** Validate a declaration, returning the result */
  validate(declaration: Declaration, context: ValidationContext): Promise<ValidationResult>;
}

/** Context passed to validators during validation */
export interface ValidationContext {
  /** Workspace root path for filesystem-relative resolution */
  workspaceRoot: string;
  /** The full schema being validated (for cross-reference) */
  schema: Schema;
}

// ── Validation Results ──────────────────────────────────────────

/** Result of validating a single declaration */
export interface ValidationResult {
  /** The declaration that was validated */
  declaration: Declaration;
  /** Whether the declaration holds true */
  valid: boolean;
  /** Human-readable explanation */
  message: string;
  /** Suggested remediation action */
  remediation?: string;
  /** When this declaration started drifting (if known) */
  staleSince?: Date;
  /** What was actually found (if different from declared) */
  actual?: string;
}

/** A complete drift report for one schema */
export interface DriftReport {
  /** Which schema was validated */
  schemaId: string;
  /** Schema version at time of validation */
  schemaVersion: string;
  /** When this report was generated */
  timestamp: Date;
  /** All validation results */
  results: ValidationResult[];
  /** Only the invalid results */
  drift: ValidationResult[];
  /** Summary statistics */
  summary: DriftSummary;
}

/** Summary statistics for a drift report */
export interface DriftSummary {
  total: number;
  valid: number;
  invalid: number;
  byKind: Record<string, { total: number; invalid: number }>;
  bySeverity: Record<DeclarationSeverity, { total: number; invalid: number }>;
}

/** Difference between two drift reports */
export interface DriftDelta {
  /** New violations not in previous report */
  newDrift: ValidationResult[];
  /** Violations resolved since previous report */
  resolved: ValidationResult[];
  /** Violations present in both reports */
  persisting: ValidationResult[];
}

// ── Watch Configuration ─────────────────────────────────────────

/** How a schema's validation is triggered */
export interface WatchConfig {
  /** Watch strategy */
  mode: WatchMode;
  /** Interval for periodic mode (e.g., '1d', '6h', '30m') */
  interval?: string;
  /** File globs that trigger revalidation on change */
  triggers?: string[];
  /** Where to send drift notifications */
  notify?: NotifyConfig;
}

/** Notification routing for drift alerts */
export interface NotifyConfig {
  /** Post to mgmt inbox */
  inbox?: boolean;
  /** Custom webhook URL */
  webhook?: string;
}

// ── Schema History ──────────────────────────────────────────────

/** A versioned snapshot of a schema for evolution tracking */
export interface SchemaVersion {
  /** Schema id */
  schemaId: string;
  /** Version at this point */
  version: string;
  /** Full schema snapshot */
  schema: Schema;
  /** When this version was recorded */
  timestamp: Date;
}

// ── Compatibility ───────────────────────────────────────────────

/** Result of checking compatibility between two schema versions */
export interface CompatibilityResult {
  /** Whether the change is compatible under the schema's mode */
  compatible: boolean;
  /** The compatibility mode that was applied */
  mode: CompatibilityMode;
  /** Specific breaking changes found (empty if compatible) */
  breakingChanges: BreakingChange[];
}

/** A specific incompatible change between two schema versions */
export interface BreakingChange {
  /** What kind of breaking change */
  type:
    | 'declaration_removed'
    | 'declaration_added'
    | 'severity_tightened'
    | 'severity_relaxed'
    | 'kind_changed'
    | 'target_changed';
  /** Which declaration is affected */
  declaration: string;
  /** Human-readable explanation */
  detail: string;
}
