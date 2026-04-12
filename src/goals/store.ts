import Database from 'better-sqlite3';

/**
 * Manages the goals SQLite database — schema migration and raw access.
 * The GoalRegistry class wraps this with typed methods.
 */
export class GoalStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  /** Execute a query and return a single row */
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  /** Execute a query and return all rows */
  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** Execute a statement (INSERT, UPDATE, DELETE) */
  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.db.prepare(sql).run(...params);
  }

  /** Execute raw SQL (for multi-statement operations) */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        description       TEXT,
        success_criteria  TEXT,
        status            TEXT NOT NULL DEFAULT 'active'
                          CHECK(status IN ('active','achieved','failed','abandoned')),
        context_condition TEXT NOT NULL DEFAULT 'unknown'
                          CHECK(context_condition IN ('none','compiled','partial','unknown')),
        boot_payload_tokens INTEGER,
        created_at        REAL NOT NULL,
        achieved_at       REAL
      );

      CREATE TABLE IF NOT EXISTS contributions (
        id                    TEXT PRIMARY KEY,
        goal_id               TEXT NOT NULL REFERENCES goals(id),
        source                TEXT NOT NULL,
        source_id             TEXT NOT NULL,
        source_label          TEXT,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd              REAL NOT NULL DEFAULT 0,
        turns                 INTEGER NOT NULL DEFAULT 0,
        tool_calls            INTEGER NOT NULL DEFAULT 0,
        duration_ms           INTEGER NOT NULL DEFAULT 0,
        duration_api_ms       INTEGER NOT NULL DEFAULT 0,
        metadata              TEXT,
        timestamp             REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contributions_goal ON contributions(goal_id);
      CREATE INDEX IF NOT EXISTS idx_contributions_source ON contributions(source, source_id);

      CREATE TABLE IF NOT EXISTS artifacts (
        id          TEXT PRIMARY KEY,
        goal_id     TEXT NOT NULL REFERENCES goals(id),
        type        TEXT NOT NULL,
        ref         TEXT NOT NULL,
        repo        TEXT,
        linked_at   REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_goal ON artifacts(goal_id);
    `);
  }

  close(): void {
    this.db.close();
  }
}
