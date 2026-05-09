import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { telosResolver } from '../../src/resolve/telos.js';
import type { ContextSource } from '../../src/compiler/types.js';

/** Create a temporary Telos DB with the expected schema */
function createTelosDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'manual',
      cluster_id TEXT,
      urgency REAL DEFAULT 0.0,
      status TEXT DEFAULT 'active',
      snoozed_until TEXT,
      context_hints TEXT DEFAULT '{}',
      starred INTEGER DEFAULT 0,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      parent_id TEXT REFERENCES items(id)
    );
  `);
  return db;
}

describe('telosResolver', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telos-test-'));
    // Place DB at the default location relative to workspace root
    const dataDir = path.join(tmpDir, 'command_center', 'data');
    await fs.mkdir(dataDir, { recursive: true });
    dbPath = path.join(dataDir, 'smart_todo.db');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('returns true for telos origin', () => {
      expect(telosResolver.canHandle({ source: 'telos' })).toBe(true);
    });

    it('returns false for chat origin', () => {
      expect(telosResolver.canHandle({ source: 'chat' })).toBe(false);
    });

    it('returns false for calendar origin', () => {
      expect(telosResolver.canHandle({ source: 'calendar' })).toBe(false);
    });
  });

  describe('resolve', () => {
    it('returns empty manifest when entityId is missing', async () => {
      const manifest = await telosResolver.resolve({ source: 'telos' }, tmpDir, []);
      expect(manifest).toEqual({});
    });

    it('returns empty manifest when DB does not exist', async () => {
      // Remove the data dir so DB can't be found
      await fs.rm(path.join(tmpDir, 'command_center'), { recursive: true, force: true });

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abc123' },
        tmpDir,
        [],
      );
      expect(manifest).toEqual({});
    });

    it('returns empty manifest when item is not found', async () => {
      const db = createTelosDb(dbPath);
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'nonexistent' },
        tmpDir,
        [],
      );
      expect(manifest).toEqual({});
    });

    it('returns taskHint with item summary', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Build the Telos resolver',
        '{}',
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working on: Build the Telos resolver');
    });

    it('includes task_hint from context_hints', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Build the Telos resolver',
        JSON.stringify({ task_hint: 'Query SQLite, extract links' }),
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Context: Query SQLite, extract links');
    });

    it('includes Jira keys in taskHint', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Fix the auth bug',
        JSON.stringify({ jira_keys: ['RHAISTRAT-129', 'RHAISTRAT-130'] }),
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Jira: RHAISTRAT-129, RHAISTRAT-130');
    });

    it('includes session IDs in taskHint', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Continue session work',
        JSON.stringify({ session_ids: ['2026-05-03-f57087306036'] }),
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Prior sessions: 2026-05-03-f57087306036');
    });

    it('includes parent context for subtasks', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'parent1234567890',
        'Dynamic session-origin boot context',
        '{}',
      );
      db.prepare(
        'INSERT INTO items (id, summary, context_hints, parent_id) VALUES (?, ?, ?, ?)',
      ).run('child01234567890', 'Phase 2: Telos resolver', '{}', 'parent1234567890');
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'child01234567890' },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working on: Dynamic session-origin boot context');
      expect(manifest.taskHint).toContain('Subtask: Phase 2: Telos resolver');
    });

    it('supports prefix ID matching', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Prefix-matched item',
        '{}',
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef12' },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working on: Prefix-matched item');
    });

    it('does not match ambiguous prefixes', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Item A',
        '{}',
      );
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567891',
        'Item B',
        '{}',
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef' },
        tmpDir,
        [],
      );

      // Ambiguous prefix — no match
      expect(manifest).toEqual({});
    });

    it('adds linked paths as additional sources', async () => {
      // Create a file to link
      const linkedFile = path.join(tmpDir, 'docs', 'design.md');
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
      await fs.writeFile(linkedFile, '# Design doc');

      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Build feature',
        JSON.stringify({ paths: ['docs/design.md'] }),
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      expect(manifest.sources).toHaveLength(1);
      expect(manifest.sources![0].relativePath).toBe('docs/design.md');
      expect(manifest.sources![0].kind).toBe('reference');
    });

    it('skips linked paths that do not exist', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Build feature',
        JSON.stringify({ paths: ['nonexistent/file.md'] }),
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      expect(manifest.sources).toBeUndefined();
    });

    it('does not duplicate paths already in default sources', async () => {
      const existingFile = path.join(tmpDir, 'CONSTITUTION.md');
      await fs.writeFile(existingFile, '# Constitution');

      const defaultSources: ContextSource[] = [
        { path: existingFile, kind: 'constitution', relativePath: 'CONSTITUTION.md' },
      ];

      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Build feature',
        JSON.stringify({ paths: ['CONSTITUTION.md'] }),
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        defaultSources,
      );

      // No additional sources — the path is already in defaults
      expect(manifest.sources).toBeUndefined();
    });

    it('uses metadata.dbPath override when provided', async () => {
      // Create DB in a non-standard location
      const customDir = path.join(tmpDir, 'custom');
      await fs.mkdir(customDir, { recursive: true });
      const customDbPath = path.join(customDir, 'telos.db');

      const db = createTelosDb(customDbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Custom DB item',
        '{}',
      );
      db.close();

      // Remove default location
      await fs.rm(path.join(tmpDir, 'command_center'), { recursive: true, force: true });

      const manifest = await telosResolver.resolve(
        {
          source: 'telos',
          entityId: 'abcdef1234567890',
          metadata: { dbPath: customDbPath },
        },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working on: Custom DB item');
    });

    it('handles malformed context_hints JSON gracefully', async () => {
      const db = createTelosDb(dbPath);
      db.prepare('INSERT INTO items (id, summary, context_hints) VALUES (?, ?, ?)').run(
        'abcdef1234567890',
        'Bad hints item',
        'not valid json{{{',
      );
      db.close();

      const manifest = await telosResolver.resolve(
        { source: 'telos', entityId: 'abcdef1234567890' },
        tmpDir,
        [],
      );

      // Should still return a taskHint from the summary
      expect(manifest.taskHint).toContain('Working on: Bad hints item');
    });
  });
});
