import type { Schema, Validator } from './types.js';

// ── Schema Provider Interface ───────────────────────────────────
//
// Providers are plugins that discover, extract, and validate schemas
// from specific domains. Each provider knows how to interpret one
// kind of schema source (workspace constitutions, memory vaults,
// service manifests, etc.).

/** A discoverable source from which a schema can be extracted */
export interface SchemaSource {
  /** Unique identifier for this source */
  id: string;
  /** Filesystem path to the source */
  path: string;
  /** Source type (e.g., 'constitution', 'memory-vault', 'service-manifest') */
  type: string;
  /** Which workspace root this source belongs to */
  root: string;
}

/**
 * Plugin interface for schema discovery, extraction, and validation.
 *
 * Each provider handles a specific domain:
 * - WorkspaceProvider: CONSTITUTION.md hub-and-spoke topology
 * - MemoryProvider: memory vault structure, freshness, linkage
 * - ServiceProvider: service health, agent journals
 *
 * The registry calls these methods in order:
 * 1. discover() — find schema sources across workspace roots
 * 2. extract() — parse a source into a Schema with declarations
 * 3. createValidators() — return validators for this provider's declaration kinds
 */
export interface SchemaProvider {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable provider name */
  readonly name: string;

  /**
   * Discover schema sources in the given workspace roots.
   *
   * For workspace: finds CONSTITUTION.md files.
   * For memory: finds memory/ directories.
   * For service: finds SERVICES.md or service manifests.
   */
  discover(roots: string[]): Promise<SchemaSource[]>;

  /**
   * Extract a Schema from a discovered source.
   *
   * Parses the source and produces a Schema with typed Declarations
   * describing the expected state of the system.
   */
  extract(source: SchemaSource): Promise<Schema>;

  /**
   * Create validators for this provider's declaration kinds.
   *
   * Each validator handles one declaration kind. The registry
   * merges validators from all providers into a unified set.
   */
  createValidators(): Validator[];
}
