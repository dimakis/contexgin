import Database from 'better-sqlite3';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  /** Additional file or directory selections allowed to be absent. */
  optionalPaths?: string[];
  /** Optional literal files or directory prefixes omitted before blob acquisition. */
  excludePaths?: string[];
  /** Exclude an exact path segment at any nesting depth. */
  excludePathSegments?: string[];
  /** Omit files with any dot-prefixed path segment. */
  excludeHiddenPaths?: boolean;
}
export interface PublicationConfig {
  root: string;
  sources: KnowledgeSource[];
  /** User workspace roots that private publisher state must remain disjoint from. */
  workspaceRoots?: string[];
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
  retry: number;
  attempts: number;
}
const execute = promisify(execFile);
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function physicalPath(value: string): string {
  let ancestor = resolve(value);
  const tail: string[] = [];
  for (;;) {
    try {
      lstatSync(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      tail.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  return join(realpathSync(ancestor), ...tail);
}
function within(parent: string, child: string): boolean {
  return parent === child || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}
function privateRoot(config: PublicationConfig): string {
  // Resolve existing parents before mkdir; /var aliases on macOS remain usable.
  try {
    if (lstatSync(config.root).isSymbolicLink())
      throw new Error('Publication root cannot be a symlink');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const root = physicalPath(config.root);
  const protectedRoots = [...(config.workspaceRoots ?? [])];
  for (const source of config.sources) {
    if (isAbsolute(source.url)) protectedRoots.push(source.url);
    else if (source.url.startsWith('file://')) protectedRoots.push(fileURLToPath(source.url));
  }
  for (const workspace of protectedRoots) {
    const physical = physicalPath(workspace);
    if (within(physical, root) || within(root, physical))
      throw new Error('Publication root must be outside user workspaces');
  }
  // Also protect Git checkouts not explicitly registered with the daemon.
  let ancestor = root;
  for (;;) {
    let marker = false;
    try {
      lstatSync(join(ancestor, '.git'));
      marker = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (marker) throw new Error('Publication root must be outside Git checkouts');
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return root;
}
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
function encodeContext(context: unknown, root: string): string {
  return JSON.stringify(context, (_key, value: unknown) =>
    typeof value === 'string' ? value.split(root).join('source') : value,
  );
}
const safePath = (value: string) =>
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.split('/').some((p) => p === '..' || p === '.' || p === '');
const matchesPath = (path: string, policy: string) =>
  policy.endsWith('/') ? path.startsWith(policy) : path === policy;
const selectedPath = (path: string, source: KnowledgeSource) =>
  [...source.paths, ...(source.optionalPaths ?? [])].some((policy) => matchesPath(path, policy)) &&
  !source.excludePaths?.some((policy) => matchesPath(path, policy)) &&
  !path.split('/').some((part) => source.excludePathSegments?.includes(part)) &&
  !(source.excludeHiddenPaths && path.split('/').some((part) => part.startsWith('.')));

/** Application layer: acquires sources into private state, never changes user checkouts. */
export class KnowledgePublisher {
  private db: Database.Database;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private rescan = false;
  private admissions = new Set<() => void>();
  readonly sources: readonly KnowledgeSource[];

  constructor(private config: PublicationConfig) {
    if (!isAbsolute(config.root) || !Array.isArray(config.sources) || !config.sources.length)
      throw new Error('Absolute private root and sources required');
    const ids = new Set<string>();
    for (const source of config.sources) {
      if (
        typeof source.id !== 'string' ||
        !/^[a-zA-Z0-9_-]+$/.test(source.id) ||
        ids.has(source.id)
      )
        throw new Error('Invalid or duplicate source id');
      ids.add(source.id);
      if (
        typeof source.url !== 'string' ||
        !source.url ||
        source.url.startsWith('-') ||
        !validRef(source.ref) ||
        (source.githubRepository !== undefined && typeof source.githubRepository !== 'string')
      )
        throw new Error('Invalid Git source');
      if (
        !Array.isArray(source.paths) ||
        !source.paths.length ||
        source.paths.some(
          (p) => typeof p !== 'string' || !safePath(p.endsWith('/') ? p.slice(0, -1) : p),
        )
      )
        throw new Error('Explicit safe portable paths required');
      if (
        source.optionalPaths !== undefined &&
        (!Array.isArray(source.optionalPaths) ||
          source.optionalPaths.some(
            (p) => typeof p !== 'string' || !safePath(p.endsWith('/') ? p.slice(0, -1) : p),
          ))
      )
        throw new Error('Explicit safe optional paths required');
      if (
        source.excludePaths !== undefined &&
        (!Array.isArray(source.excludePaths) ||
          source.excludePaths.some(
            (p) => typeof p !== 'string' || !safePath(p.endsWith('/') ? p.slice(0, -1) : p),
          ))
      )
        throw new Error('Explicit safe exclusion paths required');
      if (
        source.excludePathSegments !== undefined &&
        (!Array.isArray(source.excludePathSegments) ||
          source.excludePathSegments.some(
            (p) => typeof p !== 'string' || p.includes('/') || !safePath(p),
          ))
      )
        throw new Error('Explicit safe exclusion segments required');
      if (source.excludeHiddenPaths !== undefined && typeof source.excludeHiddenPaths !== 'boolean')
        throw new Error('Boolean hidden-path exclusion required');
    }
    config = { ...structuredClone(config), root: privateRoot(config) };
    this.config = config;
    this.sources = structuredClone(config.sources);
    for (const source of this.sources) {
      Object.freeze(source.paths);
      if (source.optionalPaths) Object.freeze(source.optionalPaths);
      if (source.excludePaths) Object.freeze(source.excludePaths);
      if (source.excludePathSegments) Object.freeze(source.excludePathSegments);
      Object.freeze(source);
    }
    Object.freeze(this.sources);
    const newParents = [config.root];
    let parent = dirname(config.root);
    while (!existsSync(parent)) {
      newParents.push(parent);
      parent = dirname(parent);
    }
    newParents.push(parent);
    mkdirSync(config.root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(config.root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('Publication root must be an owned private directory');
    // Persist newly created directory entries before any webhook may be acknowledged.
    for (const directory of newParents) {
      const fd = openSync(directory, 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    // SQLite opens sidecars itself; reject redirects before any durable state is opened.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        const file = lstatSync(join(config.root, 'publication.sqlite3' + suffix));
        if (
          !file.isFile() ||
          file.isSymbolicLink() ||
          file.nlink !== 1 ||
          file.uid !== process.getuid?.()
        )
          throw new Error('Unsafe SQLite state file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
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
      .prepare(
        'SELECT requested, completed, error, publication, retry, attempts FROM sources WHERE id=?',
      )
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
      this.db.prepare('UPDATE sources SET requested=requested+1 WHERE id=?').run(id);
      this.rescan = true;
      return true;
    })();
  }

  /** Wait only for this admission's generation, independently of unrelated deliveries. */
  async reconcile(id: string): Promise<boolean> {
    if (this.closed) return false;
    this.enqueue(id);
    const generation = this.status(id).requested;
    return new Promise<boolean>((resolve, reject) => {
      const finish = (fresh: boolean) => {
        clearInterval(timer);
        this.admissions.delete(check);
        resolve(fresh);
      };
      const fail = (error: unknown) => {
        clearInterval(timer);
        this.admissions.delete(check);
        reject(error);
      };
      const check = () => {
        if (!this.admissions.has(check)) return;
        if (this.closed) return finish(false);
        const state = this.status(id);
        if (state.completed >= generation || state.retry > Date.now())
          finish(state.completed >= generation && !state.error);
      };
      // Local completion is event-driven; this check also observes another lease holder.
      const timer = setInterval(() => {
        check();
        if (this.admissions.has(check)) void this.drain().then(check, fail);
      }, 1000);
      timer.unref();
      this.admissions.add(check);
      check();
      void this.drain().then(check, fail);
    });
  }

  /** Operator-only early retry: at most once per minute after the last failed attempt. */
  requestRetry(id: string): boolean {
    this.status(id);
    const changed = this.db
      .prepare(
        `UPDATE sources SET requested=requested+1, retry=0
      WHERE id=? AND retry>0 AND expires<=? AND
      ? >= retry - min(1800000,60000*(1 << min(max(attempts-1,0),5))) + 60000`,
      )
      .run(id, Date.now(), Date.now()).changes;
    if (changed) this.rescan = true;
    return changed > 0;
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
      if (this.closed) return;
      {
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
        if (!claim) continue;
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
        } finally {
          clearInterval(renewal);
          for (const notify of this.admissions) notify();
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
    const checkChild = (directory: string) => {
      if (privateRoot({ ...this.config, root: directory }) !== directory)
        throw new Error('Unsafe private state directory');
    };
    checkChild(sourceRoot);
    await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
    const mirror = join(sourceRoot, 'mirror.git');
    checkChild(mirror);
    await mkdir(mirror, { recursive: true, mode: 0o700 });
    const validateMirror = async (directory: string): Promise<void> => {
      for (const name of await readdir(directory)) {
        const path = join(directory, name);
        const stat = lstatSync(path);
        if (
          stat.isSymbolicLink() ||
          stat.uid !== process.getuid?.() ||
          (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
        )
          throw new Error('Unsafe Git mirror contents');
        if (stat.isDirectory()) await validateMirror(path);
      }
    };
    await validateMirror(mirror);
    await this.git(mirror, ['init', '--bare']);
    const fetchRef = `refs/publication/${randomUUID()}`;
    try {
      await this.git(mirror, [
        'fetch',
        '--no-write-fetch-head',
        '--no-tags',
        '--force',
        '--',
        source.url,
        `${source.ref}:${fetchRef}`,
      ]);
      const revision = (await this.git(mirror, ['rev-parse', `${fetchRef}^{commit}`])).toString();
      const retained = this.current(source.id);
      if (retained?.revision === revision && (await this.verify(retained, source))) return retained;
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
          if (!selectedPath(name, source)) continue;
          if (
            !name.endsWith('.md') &&
            [...source.paths, ...(source.optionalPaths ?? [])].some(
              (p) => p.endsWith('/') && name.startsWith(p),
            )
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
        const contextJson = encodeContext(context, join(staging, 'source'));
        await writeFile(join(staging, 'context.json'), contextJson, { mode: 0o600 });
        const manifest = JSON.stringify({
          schema: 'contexgin-portable-v1',
          source: source.id,
          acceptedRef: source.ref,
          sourceIdentity: hash(JSON.stringify(source)),
          revision,
          paths: source.paths,
          ...(source.optionalPaths !== undefined ? { optionalPaths: source.optionalPaths } : {}),
          ...(source.excludePaths !== undefined ? { excludePaths: source.excludePaths } : {}),
          ...(source.excludePathSegments !== undefined
            ? { excludePathSegments: source.excludePathSegments }
            : {}),
          ...(source.excludeHiddenPaths !== undefined
            ? { excludeHiddenPaths: source.excludeHiddenPaths }
            : {}),
          files,
          contextSha256: hash(contextJson),
        });
        await writeFile(join(staging, 'manifest.json'), manifest, { mode: 0o600 });
        if (
          !(await this.verify(
            { revision, directory: staging, manifestSha256: hash(manifest) },
            source,
          ))
        )
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
        const rootHandle = await open(this.config.root, 'r');
        try {
          await rootHandle.sync();
        } finally {
          await rootHandle.close();
        }
        return { revision, directory: final, manifestSha256: hash(manifest) };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } finally {
      // Each acquisition owns its ref; an overlapping worker cannot change its revision.
      await this.git(mirror, ['update-ref', '-d', fetchRef]).catch(() => undefined);
    }
  }
  private async verify(publication: Publication, source: KnowledgeSource): Promise<boolean> {
    try {
      if (!within(join(this.config.root, source.id), realpathSync(publication.directory)))
        return false;
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
        source: string;
        revision: string;
        contextSha256: string;
        acceptedRef: string;
        sourceIdentity: string;
        paths: string[];
        optionalPaths?: string[];
        excludePaths?: string[];
        excludePathSegments?: string[];
        excludeHiddenPaths?: boolean;
        files: { path: string; sha256: string; bytes: number }[];
      };
      if (manifest.schema !== 'contexgin-portable-v1' || manifest.revision !== publication.revision)
        return false;
      if (
        manifest.acceptedRef !== source.ref ||
        manifest.source !== source.id ||
        manifest.sourceIdentity !== hash(JSON.stringify(source)) ||
        JSON.stringify(manifest.paths) !== JSON.stringify(source.paths) ||
        JSON.stringify(manifest.optionalPaths) !== JSON.stringify(source.optionalPaths) ||
        JSON.stringify(manifest.excludePaths) !== JSON.stringify(source.excludePaths) ||
        JSON.stringify(manifest.excludePathSegments) !==
          JSON.stringify(source.excludePathSegments) ||
        manifest.excludeHiddenPaths !== source.excludeHiddenPaths ||
        !manifest.files.length ||
        manifest.files.some(
          (file) => !file.path.endsWith('.md') || !selectedPath(file.path, source),
        )
      )
        return false;
      const expected = new Set([
        'manifest.json',
        'context.json',
        ...manifest.files.map((f) => `source/${f.path}`),
      ]);
      const actual = new Set<string>();
      if (expected.size !== manifest.files.length + 2) return false;
      const walk = async (directory: string, prefix: string): Promise<boolean> => {
        for (const name of await readdir(directory)) {
          const target = join(directory, name);
          const relative = prefix + name;
          const entry = lstatSync(target);
          if (entry.isDirectory()) {
            if (!(await walk(target, relative + '/'))) return false;
          } else if (entry.isFile() && expected.has(relative)) actual.add(relative);
          else return false;
        }
        return true;
      };
      if (!(await walk(publication.directory, '')) || actual.size !== expected.size) return false;
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
        const info = lstatSync(target);
        if (!info.isFile() || info.size !== file.bytes) return false;
        if (hash(await readFile(target)) !== file.sha256) return false;
      }
      const context = await compile({
        workspaceRoot: join(publication.directory, 'source'),
        tokenBudget: 12_000,
      });
      const encoded = encodeContext(context, join(publication.directory, 'source'));
      return hash(encoded) === manifest.contextSha256;
    } catch {
      return false;
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.timer) clearInterval(this.timer);
    this.closed = true;
    for (const notify of this.admissions) notify();
    await this.flight;
    this.db.close();
  }
}
