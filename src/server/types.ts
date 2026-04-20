import type { HubGraph, Violation } from '../graph/types.js';
import type { SerializedNode } from '../compiler/types.js';

// ── Defaults ───────────────────────────────────────────────────

/** Default token budget for the /compile endpoint when none is specified. */
export const DEFAULT_COMPILE_BUDGET = 12_000;

// ── Server Configuration ────────────────────────────────────────

export interface ServerConfig {
  /** TCP port (0 = auto-assign) */
  port: number;
  /** TCP host to bind */
  host: string;
  /** Unix socket path (null = no socket) */
  socketPath: string | null;
  /** Workspace roots to watch */
  roots: string[];
  /** SQLite database path */
  dbPath: string;
  /** Goals SQLite database path */
  goalsDbPath: string;
  /** File watcher debounce interval in ms */
  debounceMs: number;
  /** Enable file watching */
  watch: boolean;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 4195,
  host: '127.0.0.1',
  socketPath: null,
  roots: [],
  dbPath: ':memory:',
  goalsDbPath: ':memory:',
  debounceMs: 500,
  watch: true,
};

// ── Server State ────────────────────────────────────────────────

export interface ServerState {
  /** Current structural graph */
  graph: HubGraph | null;
  /** When the graph was last built */
  lastBuild: Date | null;
  /** When the server started */
  startedAt: Date;
  /** Whether a rebuild is in progress */
  rebuilding: boolean;
  /** Violation counts from last validation */
  violations: { errors: number; warnings: number; info: number };
}

// ── API Types ───────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'building';
  uptime: number;
  hubs: number;
  spokes: number;
  lastBuild: string | null;
  violations: { errors: number; warnings: number; info: number };
}

export interface CompileRequest {
  /** Spoke path or id to compile context for */
  spoke: string;
  /** Optional task description for relevance ranking */
  task?: string;
  /** Token budget */
  budget?: number;
  /** Use legacy compile pipeline instead of adapters (default: false) */
  legacy?: boolean;
}

export interface CompileResponse {
  context: string;
  tokens: number;
  sources: number;
  spoke: string;
  /** Typed context nodes (adapter pipeline) */
  nodes?: SerializedNode[];
}

export interface ValidateRequest {
  /** Roots to validate (defaults to server roots) */
  roots?: string[];
}

export interface ValidateResponse {
  violations: Violation[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    hubs: number;
    spokes: number;
  };
}

export interface GraphResponse {
  hubs: Array<{
    id: string;
    name: string;
    path: string;
    purpose: string;
    spokes: Array<{
      id: string;
      name: string;
      path: string;
      confidentiality: string;
      hasConstitution: boolean;
    }>;
    externals: Array<{ path: string; description?: string }>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: string;
    description?: string;
  }>;
  violations: number;
}
