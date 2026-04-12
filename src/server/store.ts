import Database from 'better-sqlite3';
import type { HubGraph } from '../graph/types.js';

export interface GraphSnapshot {
  id: number;
  timestamp: string;
  hubs: number;
  spokes: number;
  edges: number;
  violations: number;
  graph: HubGraph;
}

/** Maximum number of snapshots to retain */
const MAX_SNAPSHOTS = 50;

export class GraphStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        hubs INTEGER NOT NULL,
        spokes INTEGER NOT NULL,
        edges INTEGER NOT NULL,
        violations INTEGER NOT NULL,
        graph_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS builds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        duration_ms INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT
      );
    `);
  }

  /** Save a graph snapshot, returning the snapshot id */
  saveSnapshot(graph: HubGraph): number {
    const spokeCount = graph.hubs.reduce((n, h) => n + h.spokes.length, 0);
    const stmt = this.db.prepare(`
      INSERT INTO snapshots (hubs, spokes, edges, violations, graph_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      graph.hubs.length,
      spokeCount,
      graph.edges.length,
      graph.violations.length,
      JSON.stringify(graph),
    );
    const id = result.lastInsertRowid as number;
    this.pruneSnapshots();
    return id;
  }

  /** Remove old snapshots beyond the retention limit */
  private pruneSnapshots(): void {
    this.db
      .prepare(
        `DELETE FROM snapshots WHERE id NOT IN (
          SELECT id FROM snapshots ORDER BY id DESC LIMIT ?
        )`,
      )
      .run(MAX_SNAPSHOTS);
  }

  /** Get the latest snapshot */
  getLatestSnapshot(): GraphSnapshot | null {
    const row = this.db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get() as
      | {
          id: number;
          timestamp: string;
          hubs: number;
          spokes: number;
          edges: number;
          violations: number;
          graph_json: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      timestamp: row.timestamp,
      hubs: row.hubs,
      spokes: row.spokes,
      edges: row.edges,
      violations: row.violations,
      graph: JSON.parse(row.graph_json),
    };
  }

  /** Record a build event */
  recordBuild(durationMs: number, trigger: string, success: boolean, error?: string): void {
    this.db
      .prepare(
        `
      INSERT INTO builds (duration_ms, trigger, success, error)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(durationMs, trigger, success ? 1 : 0, error ?? null);
  }

  /** Get recent build history */
  getBuilds(limit = 20): Array<{
    id: number;
    timestamp: string;
    duration_ms: number;
    trigger: string;
    success: boolean;
    error: string | null;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM builds ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{
      id: number;
      timestamp: string;
      duration_ms: number;
      trigger: string;
      success: number;
      error: string | null;
    }>;

    return rows.map((r) => ({ ...r, success: r.success === 1 }));
  }

  close(): void {
    this.db.close();
  }
}
