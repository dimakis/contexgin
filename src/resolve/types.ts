/**
 * Session origin metadata — how a session was triggered.
 * Used by resolvers to determine what additional context to inject.
 */

import type { ContextSource } from '../compiler/types.js';

/** Session origin source — what triggered the session */
export type OriginSource = 'chat' | 'telos' | 'calendar' | 'file' | 'page';

/** Session origin metadata */
export interface SessionOrigin {
  /** How the session was initiated */
  source: OriginSource;
  /** Entity ID that triggered the session (e.g., Telos item ID, calendar event ID, file path) */
  entityId?: string;
  /** Additional metadata specific to the origin type */
  metadata?: Record<string, unknown>;
}

/** Resolved context manifest — what sources to include in compilation */
export interface ResolvedManifest {
  /** Context sources to compile (may be modified from agent definition defaults) */
  sources?: ContextSource[];
  /** Additional excluded sections (merged with agent definition excludes) */
  excluded?: string[][];
  /** Injected task hint (prepended to agent definition task hint if present) */
  taskHint?: string;
}

/**
 * Origin resolver interface.
 * Implementations determine what context to inject based on session origin.
 */
export interface OriginResolver {
  /** Which origin source this resolver handles */
  source: OriginSource;

  /** Whether this resolver can handle the given origin */
  canHandle(origin: SessionOrigin): boolean;

  /**
   * Resolve additional context sources based on origin metadata.
   * @param origin - Session origin metadata
   * @param workspaceRoot - Workspace root directory
   * @param defaultSources - Default sources from agent definition
   * @returns Resolved manifest with additional sources/excludes/hints
   */
  resolve(
    origin: SessionOrigin,
    workspaceRoot: string,
    defaultSources: ContextSource[],
  ): Promise<ResolvedManifest>;
}
