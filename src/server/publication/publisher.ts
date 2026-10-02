import Database from 'better-sqlite3';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { compile } from '../../compiler/index.js';

export interface KnowledgeSource {
  id: string;
  url: string;
  /** Fully qualified accepted Git ref, never a webhook-supplied revision. */
  ref: string;
  githubRepository?: string;
  /** Explicit portable Markdown files or directory prefixes ending in /. */
  paths: string[];
}
export interface PublicationConfig {
  root: string;
  sources: KnowledgeSource[];
}
export interface Publication {
  revision: string;
  directory: string;
  manifestSha256: string;
}
interface State {
  requested: number;
  completed: number;
  error: string | null;
  publication: string | null;
}
const execute = promisify(execFile);
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function validRef(ref: string): boolean {
  if (typeof ref !== 'string' || !ref.startsWith('refs/')) return false;
  try {
    execFileSync('git', ['check-ref-format', ref], {
      stdio: 'ignore',
      timeout: 5000,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
      ),
    });
    return true;
  } catch {
    return false;
  }
}
const safePath = (value: string) =>
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.split('/').some((p) => p === '..' || p === '.' || p === '');

/** Application layer: acquires sources into private state, never changes user checkouts. */
export class KnowledgePublisher {
  private db: Database.Database;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private rescan = false;
  readonly sources: KnowledgeSource[];

  constructor(private config: PublicationConfig) {
    if (!isAbsolute(config.root) || !Array.isArray(config.sources) || !config.sources.length)
      throw new Error('Absolute private root and sources required');
    const ids = new Set<string>();
    for (const source of config.sources) {
      if (!/^[a-zA-Z0-9_-]+$/.test(source.id) || ids.has(source.id))
        throw new Error('Invalid or duplicate source id');
      ids.add(source.id);
      if (!source.url || source.url.startsWith('-') || !validRef(source.ref))
        throw new Error('Invalid Git source');
      if (
        !Array.isArray(source.paths) ||
        !source.paths.length ||
        source.paths.some((p) => !safePath(p.endsWith('/') ? p.slice(0, -1) : p))
      )
        throw new Error('Explicit safe portable paths required');
    }
    this.sources = structuredClone(config.sources);
    mkdirSync(config.root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(config.root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('Publication root must be an owned private directory');
    this.db = new Database(join(config.root, 'publication.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, identity TEXT NOT NULL, requested INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0, error TEXT, publication TEXT,
      lease TEXT, expires INTEGER NOT NULL DEFAULT 0, retry INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS deliveries (source TEXT NOT NULL, delivery TEXT NOT NULL, PRIMARY KEY(source, delivery));`);
    const configure = this.db.transaction(() => {
      for (const source of this.sources) {
        const identity = hash(JSON.stringify(source));
        this.db
          .prepare('INSERT OR IGNORE INTO sources(id, identity) VALUES (?, ?)')
          .run(source.id, identity);
        // A changed source must never expose a publication from the old URL/policy.
        this.db
          .prepare(
            'UPDATE sources SET identity=?, publication=NULL, requested=requested+1, retry=0, lease=NULL, expires=0 WHERE id=? AND identity<>?',
          )
          .run(identity, source.id, identity);
      }
    });
    configure();
  }

  status(id: string): State {
    if (!this.sources.some((s) => s.id === id)) throw new Error('Unknown source');
    return this.db
      .prepare('SELECT requested, completed, error, publication FROM sources WHERE id=?')
      .get(id) as State;
  }
  current(id: string): Publication | null {
    const encoded = this.status(id).publication;
    return encoded ? (JSON.parse(encoded) as Publication) : null;
  }
  enqueue(id: string, delivery: string = randomUUID()): boolean {
    this.status(id);
    return this.db.transaction(() => {
      const result = this.db
        .prepare('INSERT OR IGNORE INTO deliveries VALUES (?, ?)')
        .run(id, delivery);
      if (!result.changes) return false;
      this.db.prepare('UPDATE sources SET requested=requested+1, retry=0 WHERE id=?').run(id);
      this.rescan = true;
      return true;
    })();
  }

  /** Webhooks wake immediately; this timer handles retries and 30-minute recovery. */
  start(): void {
    if (this.timer || this.closed) return;
    let lastRecovery = Date.now();
    for (const source of this.sources) this.enqueue(source.id);
    void this.drain();
    this.timer = setInterval(() => {
      if (Date.now() - lastRecovery >= 30 * 60_000) {
        for (const source of this.sources) this.enqueue(source.id);
        lastRecovery = Date.now();
      }
      void this.drain();
    }, 30_000);
    this.timer.unref();
  }
  wake(): void {
    if (this.timer) void this.drain();
  }
  async drain(): Promise<void> {
    if (this.closed) return;
    if (this.flight) return this.flight;
    this.flight = this.runPasses();
    try {
      await this.flight;
    } finally {
      this.flight = null;
    }
  }

  private async runPasses(): Promise<void> {
    do {
      this.rescan = false;
      await this.process();
    } while (this.rescan && !this.closed);
  }

  private async process(): Promise<void> {
    for (const source of this.sources) {
      while (!this.closed) {
        const token = randomUUID();
        const claim = this.db
          .prepare(
            `UPDATE sources SET lease=?, expires=?
          WHERE id=? AND requested>completed AND retry<=? AND expires<=? AND identity=?
          RETURNING requested, identity`,
          )
          .get(
            token,
            Date.now() + 300_000,
            source.id,
            Date.now(),
            Date.now(),
            hash(JSON.stringify(source)),
          ) as { requested: number; identity: string } | undefined;
        if (!claim) break;
        const renewal = setInterval(
          () =>
            this.db
              .prepare('UPDATE sources SET expires=? WHERE id=? AND lease=?')
              .run(Date.now() + 300_000, source.id, token),
          60_000,
        );
        try {
          const publication = await this.build(source);
          // Fencing prevents an expired worker or changed configuration promoting stale work.
          this.db
            .prepare(
              `UPDATE sources SET publication=?, completed=?, error=NULL,
            attempts=0, retry=0, lease=NULL, expires=0 WHERE id=? AND lease=? AND identity=?`,
            )
            .run(JSON.stringify(publication), claim.requested, source.id, token, claim.identity);
        } catch {
          // Do not persist Git stderr: it may contain credentials from source URLs.
          this.db
            .prepare(
              `UPDATE sources SET error='Publication failed: fetch or portable snapshot validation',
            attempts=attempts+1, retry=? + min(1800000,60000*(1 << min(attempts,5))), lease=NULL, expires=0 WHERE id=? AND lease=?`,
            )
            .run(Date.now(), source.id, token);
          break;
        } finally {
          clearInterval(renewal);
        }
      }
    }
  }

  private async git(cwd: string, args: string[], binary = false): Promise<Buffer> {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    );
    const result = await execute(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', ...args],
      { cwd, env, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
    );
    return binary ? result.stdout : Buffer.from(result.stdout.toString().trim());
  }
  private async build(source: KnowledgeSource): Promise<Publication> {
    const sourceRoot = join(this.config.root, source.id);
    await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
    const mirror = join(sourceRoot, 'mirror.git');
    await mkdir(mirror, { recursive: true, mode: 0o700 });
    await this.git(mirror, ['init', '--bare']);
    await this.git(mirror, [
      'fetch',
      '--no-tags',
      '--force',
      '--',
      source.url,
      `${source.ref}:refs/publication/accepted`,
    ]);
    const revision = (
      await this.git(mirror, ['rev-parse', 'refs/publication/accepted^{commit}'])
    ).toString();
    const retained = this.current(source.id);
    if (retained?.revision === revision && (await this.verify(retained))) return retained;
    const records = (await this.git(mirror, ['ls-tree', '-rz', revision], true))
      .toString()
      .split('\0')
      .filter(Boolean);
    const files: { path: string; sha256: string; bytes: number }[] = [];
    const staging = join(sourceRoot, `building-${randomUUID()}`);
    const final = join(sourceRoot, `snapshot-${revision}-${randomUUID()}`);
    await mkdir(join(staging, 'source'), { recursive: true, mode: 0o700 });
    try {
      let total = 0;
      for (const record of records) {
        const tab = record.indexOf('\t');
        const [mode, type, oid] = record.slice(0, tab).split(' ');
        const name = record.slice(tab + 1);
        if (!source.paths.some((p) => (p.endsWith('/') ? name.startsWith(p) : name === p)))
          continue;
        if (
          !name.endsWith('.md') &&
          source.paths.some((p) => p.endsWith('/') && name.startsWith(p))
        )
          continue;
        if (
          !safePath(name) ||
          !/^100(644|755)$/.test(mode) ||
          type !== 'blob' ||
          !name.endsWith('.md')
        )
          throw new Error('Portable paths must contain regular Markdown files');
        const content = await this.git(mirror, ['cat-file', 'blob', oid], true);
        total += content.length;
        if (total > 64 * 1024 * 1024 || files.length >= 10_000)
          throw new Error('Portable snapshot too large');
        const target = join(staging, 'source', name);
        await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
        await writeFile(target, content, { mode: 0o600 });
        files.push({ path: name, sha256: hash(content), bytes: content.length });
      }
      if (
        !files.length ||
        source.paths.some(
          (p) => !files.some((f) => (p.endsWith('/') ? f.path.startsWith(p) : f.path === p)),
        )
      )
        throw new Error('Portable paths missing');
      const context = await compile({
        workspaceRoot: join(staging, 'source'),
        tokenBudget: 12_000,
      });
      // Compiler output uses staging-local paths. Publish paths relative to the snapshot.
      const contextJson = JSON.stringify(context).split(join(staging, 'source')).join('source');
      await writeFile(join(staging, 'context.json'), contextJson, { mode: 0o600 });
      const manifest = JSON.stringify({
        schema: 'contexgin-portable-v1',
        source: source.id,
        revision,
        paths: source.paths,
        files,
        contextSha256: hash(contextJson),
      });
      await writeFile(join(staging, 'manifest.json'), manifest, { mode: 0o600 });
      for (const file of files)
        if (hash(await readFile(join(staging, 'source', file.path))) !== file.sha256)
          throw new Error('Snapshot verification failed');
      // Flush file data and directory entries before committing the durable DB pointer.
      const dirs = new Set<string>([staging, join(staging, 'source')]);
      for (const file of [
        ...files.map((f) => join('source', f.path)),
        'context.json',
        'manifest.json',
      ]) {
        const target = join(staging, file);
        const handle = await open(target, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        let parent = join(target, '..');
        while (parent !== staging) {
          dirs.add(parent);
          parent = join(parent, '..');
        }
      }
      for (const directory of [...dirs].sort((a, b) => b.length - a.length)) {
        const handle = await open(directory, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await rename(staging, final);
      const parent = await open(sourceRoot, 'r');
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      return { revision, directory: final, manifestSha256: hash(manifest) };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  private async verify(publication: Publication): Promise<boolean> {
    try {
      if (lstatSync(publication.directory).isSymbolicLink()) return false;
      for (const name of ['manifest.json', 'context.json'])
        if (
          !lstatSync(join(publication.directory, name)).isFile() ||
          lstatSync(join(publication.directory, name)).isSymbolicLink()
        )
          return false;
      const raw = await readFile(join(publication.directory, 'manifest.json'));
      if (hash(raw) !== publication.manifestSha256) return false;
      const manifest = JSON.parse(raw.toString()) as {
        schema: string;
        revision: string;
        contextSha256: string;
        files: { path: string; sha256: string }[];
      };
      if (manifest.schema !== 'contexgin-portable-v1' || manifest.revision !== publication.revision)
        return false;
      if (
        hash(await readFile(join(publication.directory, 'context.json'))) !== manifest.contextSha256
      )
        return false;
      for (const file of manifest.files) {
        if (!safePath(file.path)) return false;
        let target = publication.directory;
        for (const part of ['source', ...file.path.split('/')]) {
          target = join(target, part);
          if (lstatSync(target).isSymbolicLink()) return false;
        }
        if (hash(await readFile(target)) !== file.sha256) return false;
      }
      const context = await compile({
        workspaceRoot: join(publication.directory, 'source'),
        tokenBudget: 12_000,
      });
      const encoded = JSON.stringify(context)
        .split(join(publication.directory, 'source'))
        .join('source');
      return hash(encoded) === manifest.contextSha256;
    } catch {
      return false;
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.timer) clearInterval(this.timer);
    await this.flight;
    this.closed = true;
    this.db.close();
  }
}
