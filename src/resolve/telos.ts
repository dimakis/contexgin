/**
 * Telos origin resolver — injects task context when a session is triggered from a Telos item.
 *
 * Reads the Telos SQLite database to extract:
 * - Task summary and hint → taskHint for the compiler
 * - Linked file paths → additional context sources
 * - Parent item context (if the item is a subtask)
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import type { OriginResolver, SessionOrigin, ResolvedManifest } from './types.js';
import type { ContextSource } from '../compiler/types.js';

/** Raw row from the Telos items table */
interface TelosRow {
  id: string;
  summary: string;
  status: string;
  context_hints: string;
  parent_id: string | null;
}

/** Parsed context_hints JSON from Telos */
interface TelosContextHints {
  repos?: string[];
  paths?: string[];
  issues?: string[];
  doc_ids?: string[];
  people?: string[];
  jira_keys?: string[];
  keywords?: string[];
  task_hint?: string;
  session_ids?: string[];
}

/** Default DB path relative to workspace root (mgmt convention) */
const DEFAULT_DB_REL_PATH = 'command_center/data/smart_todo.db';

/**
 * Resolve the Telos DB path — checks metadata override, then workspace default.
 * Returns undefined if no DB is found.
 */
async function resolveDbPath(
  origin: SessionOrigin,
  workspaceRoot: string,
): Promise<string | undefined> {
  // Explicit path from harness
  if (origin.metadata?.dbPath && typeof origin.metadata.dbPath === 'string') {
    try {
      await fs.access(origin.metadata.dbPath);
      return origin.metadata.dbPath;
    } catch {
      // Explicit path doesn't exist — fall through to default
    }
  }

  // Default: <workspaceRoot>/command_center/data/smart_todo.db
  const defaultPath = path.join(workspaceRoot, DEFAULT_DB_REL_PATH);
  try {
    await fs.access(defaultPath);
    return defaultPath;
  } catch {
    return undefined;
  }
}

/**
 * Query a Telos item by ID (supports prefix matching like the Python API).
 */
function queryItem(db: Database.Database, itemId: string): TelosRow | undefined {
  // Try exact match first
  const exact = db
    .prepare('SELECT id, summary, status, context_hints, parent_id FROM items WHERE id = ?')
    .get(itemId) as TelosRow | undefined;
  if (exact) return exact;

  // Prefix match
  const prefix = db
    .prepare('SELECT id, summary, status, context_hints, parent_id FROM items WHERE id LIKE ?')
    .all(`${itemId}%`) as TelosRow[];
  if (prefix.length === 1) return prefix[0];

  return undefined;
}

/**
 * Parse context_hints JSON safely.
 */
function parseHints(raw: string): TelosContextHints {
  try {
    return JSON.parse(raw) as TelosContextHints;
  } catch {
    return {};
  }
}

/**
 * Build a taskHint string from item data and parent context.
 */
function buildTaskHint(item: TelosRow, hints: TelosContextHints, parent?: TelosRow): string {
  const parts: string[] = [];

  if (parent) {
    parts.push(`Working on: ${parent.summary}`);
    parts.push(`  Subtask: ${item.summary}`);
  } else {
    parts.push(`Working on: ${item.summary}`);
  }

  if (hints.task_hint) {
    parts.push(`Context: ${hints.task_hint}`);
  }

  if (hints.jira_keys && hints.jira_keys.length > 0) {
    parts.push(`Jira: ${hints.jira_keys.join(', ')}`);
  }

  if (hints.session_ids && hints.session_ids.length > 0) {
    parts.push(`Prior sessions: ${hints.session_ids.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Resolve linked paths from context_hints into ContextSource objects.
 * Only includes paths that actually exist on disk.
 */
async function resolveLinkedPaths(
  hints: TelosContextHints,
  workspaceRoot: string,
  defaultSources: ContextSource[],
): Promise<ContextSource[]> {
  if (!hints.paths || hints.paths.length === 0) return [];

  const existingPaths = new Set(defaultSources.map((s) => s.path));
  const additional: ContextSource[] = [];

  for (const p of hints.paths) {
    const fullPath = path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p);

    // Skip if already in default sources
    if (existingPaths.has(fullPath)) continue;

    try {
      await fs.access(fullPath);
      const relativePath = path.relative(workspaceRoot, fullPath);
      additional.push({
        path: fullPath,
        kind: 'reference',
        relativePath,
      });
    } catch {
      // Path doesn't exist — skip
    }
  }

  return additional;
}

export const telosResolver: OriginResolver = {
  source: 'telos',

  canHandle(origin: SessionOrigin): boolean {
    return origin.source === 'telos';
  },

  async resolve(
    origin: SessionOrigin,
    workspaceRoot: string,
    defaultSources: ContextSource[],
  ): Promise<ResolvedManifest> {
    if (!origin.entityId) {
      return {};
    }

    const dbPath = await resolveDbPath(origin, workspaceRoot);
    if (!dbPath) {
      console.warn('[telos-resolver] Telos database not found — returning empty manifest');
      return {};
    }

    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true });

      const item = queryItem(db, origin.entityId);
      if (!item) {
        console.warn(`[telos-resolver] Item not found: ${origin.entityId}`);
        return {};
      }

      const hints = parseHints(item.context_hints);

      // Fetch parent for subtask context
      let parent: TelosRow | undefined;
      if (item.parent_id) {
        parent = queryItem(db, item.parent_id);
      }

      // Build task hint
      const taskHint = buildTaskHint(item, hints, parent);

      // Resolve linked paths into additional sources
      const additionalSources = await resolveLinkedPaths(hints, workspaceRoot, defaultSources);

      const manifest: ResolvedManifest = { taskHint };

      if (additionalSources.length > 0) {
        manifest.sources = [...defaultSources, ...additionalSources];
      }

      return manifest;
    } finally {
      db?.close();
    }
  },
};
