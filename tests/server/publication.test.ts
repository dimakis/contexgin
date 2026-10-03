import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { KnowledgePublisher } from '../../src/server/publication/publisher.js';
import type { KnowledgeSource, Publication } from '../../src/server/publication/publisher.js';
import { publicationRoutes } from '../../src/server/publication/routes.js';

describe('knowledge publication', () => {
  let root: string;
  let repo: string;
  let publisher: KnowledgePublisher;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args],
      { encoding: 'utf8' },
    ).trim();
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'contexgin-publish-'));
    repo = join(root, 'source');
    await mkdir(repo);
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    await writeFile(join(repo, 'AGENTS.md'), '# Instructions\n\nRemember zircon.\n');
    await writeFile(join(repo, 'secret.txt'), 'must not be published');
    git('add', '.');
    git('commit', '-m', 'initial');
    publisher = new KnowledgePublisher({
      root: join(root, 'state'),
      sources: [
        {
          id: 'notes',
          url: repo,
          ref: 'refs/heads/main',
          githubRepository: 'example/notes',
          paths: ['AGENTS.md'],
        },
      ],
    });
  });
  afterEach(async () => {
    await publisher?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('persists an event before processing and recovers it after restart', async () => {
    expect(publisher.enqueue('notes', 'delivery-1')).toBe(true);
    expect(publisher.enqueue('notes', 'delivery-1')).toBe(false);
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'state'),
      sources: [
        {
          id: 'notes',
          url: repo,
          ref: 'refs/heads/main',
          githubRepository: 'example/notes',
          paths: ['AGENTS.md'],
        },
      ],
    });
    await publisher.drain();
    const publication = publisher.current('notes')!;
    expect(publication.revision).toBe(git('rev-parse', 'main'));
    expect(await readFile(join(publication.directory, 'source/AGENTS.md'), 'utf8')).toContain(
      'zircon',
    );
    expect(
      JSON.parse(await readFile(join(publication.directory, 'manifest.json'), 'utf8')).files.map(
        (f: { path: string }) => f.path,
      ),
    ).toEqual(['AGENTS.md']);
    expect(await readFile(join(publication.directory, 'context.json'), 'utf8')).toContain('zircon');
    const legacy = JSON.parse(await readFile(join(publication.directory, 'manifest.json'), 'utf8'));
    for (const field of [
      'optionalPaths',
      'excludePaths',
      'excludePathSegments',
      'excludeHiddenPaths',
    ])
      expect(legacy).not.toHaveProperty(field);
    expect(legacy.sourceIdentity).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            id: 'notes',
            url: repo,
            ref: 'refs/heads/main',
            githubRepository: 'example/notes',
            paths: ['AGENTS.md'],
          }),
        )
        .digest('hex'),
    );
  });

  it('fetches the accepted ref, preserves dirty checkout and keeps the last publication on failure', async () => {
    publisher.enqueue('notes', 'first');
    await publisher.drain();
    const first = publisher.current('notes')!;
    await writeFile(join(repo, 'AGENTS.md'), 'uncommitted private changes');
    publisher.enqueue('notes', 'second');
    await publisher.drain();
    expect(publisher.current('notes')!.revision).toBe(first.revision);
    expect(await readFile(join(repo, 'AGENTS.md'), 'utf8')).toBe('uncommitted private changes');
    const beforeFailure = publisher.current('notes');
    git('branch', '-m', 'main', 'gone');
    publisher.enqueue('notes', 'third');
    await publisher.drain();
    expect(publisher.current('notes')).toEqual(beforeFailure);
    expect(publisher.status('notes').error).toBeTruthy();
    git('branch', '-m', 'gone', 'main');
    publisher.enqueue('notes', 'retry');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    try {
      await publisher.drain();
    } finally {
      clock.mockRestore();
    }
    expect(publisher.status('notes').error).toBeNull();
  });

  it('verifies exact webhook bytes and queues only the configured branch', async () => {
    const app = Fastify();
    publicationRoutes(app, publisher, 'test-secret', 'read-token');
    const payload = JSON.stringify({
      repository: { full_name: 'example/notes' },
      ref: 'refs/heads/main',
      after: 'untrusted-sha',
    });
    const headers = {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': 'd1',
      'x-hub-signature-256': `sha256=${createHmac('sha256', 'test-secret').update(payload).digest('hex')}`,
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/publications/github',
          headers: { 'content-type': 'text/plain' },
          payload,
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/publications/github',
          headers: { ...headers, 'x-hub-signature-256': 'bad' },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(publisher.status('notes').requested).toBe(0);
    expect(
      (await app.inject({ method: 'POST', url: '/api/publications/github', headers, payload }))
        .statusCode,
    ).toBe(202);
    expect(publisher.status('notes').requested).toBe(1);
    expect(
      (await app.inject({ method: 'POST', url: '/api/publications/github', headers, payload }))
        .statusCode,
    ).toBe(202);
    expect(publisher.status('notes').requested).toBe(1);
    await publisher.drain();
    expect(publisher.current('notes')!.revision).toBe(git('rev-parse', 'main'));
    expect((await app.inject({ url: '/api/publications/notes' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/publications/notes',
          headers: { authorization: 'Bearer read-token' },
        })
      ).json().current.revision,
    ).toBe(git('rev-parse', 'main'));
    await writeFile(join(repo, 'AGENTS.md'), '# New accepted instructions\n\nRemember topaz.\n');
    git('add', 'AGENTS.md');
    git('commit', '-m', 'new accepted knowledge');
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/publications/notes/reconcile',
      headers: { authorization: 'Bearer read-token' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().current.revision).toBe(git('rev-parse', 'main'));
    git('branch', '-m', 'main', 'gone');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/publications/notes/reconcile',
          headers: { authorization: 'Bearer read-token' },
        })
      ).statusCode,
    ).toBe(503);
    await app.close();
  });

  it('rejects unsafe configuration and source symlinks', async () => {
    expect(
      () =>
        new KnowledgePublisher({
          root: join(root, 'bad'),
          sources: [{ id: '../escape', url: repo, ref: 'refs/heads/main', paths: ['AGENTS.md'] }],
        }),
    ).toThrow();
    git(
      'update-index',
      '--add',
      '--cacheinfo',
      '120000',
      git('hash-object', '-w', 'AGENTS.md'),
      'link.md',
    );
    git('commit', '-m', 'symlink');
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'other'),
      sources: [{ id: 'notes', url: repo, ref: 'refs/heads/main', paths: ['link.md'] }],
    });
    publisher.enqueue('notes', 'symlink');
    await publisher.drain();
    expect(publisher.current('notes')).toBeNull();
    expect(publisher.status('notes').error).toContain('validation');
  });

  it('coalesces bursts and repairs a corrupted retained publication', async () => {
    for (let i = 0; i < 20; i++) publisher.enqueue('notes', `burst-${i}`);
    await publisher.drain();
    const first = publisher.current('notes')!;
    publisher.enqueue('notes', 'unchanged');
    await publisher.drain();
    expect(publisher.current('notes')).toEqual(first);
    await writeFile(join(first.directory, 'source/AGENTS.md'), 'corrupt');
    publisher.enqueue('notes', 'repair');
    await publisher.drain();
    expect(publisher.current('notes')!.directory).not.toBe(first.directory);
    expect(
      await readFile(join(publisher.current('notes')!.directory, 'source/AGENTS.md'), 'utf8'),
    ).toContain('zircon');
    expect(publisher.status('notes').completed).toBe(publisher.status('notes').requested);
  });

  it('invalidates publications when portable policy changes', async () => {
    publisher.enqueue('notes', 'initial');
    await publisher.drain();
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'state'),
      sources: [{ id: 'notes', url: repo, ref: 'refs/heads/main', paths: ['missing.md'] }],
    });
    expect(publisher.current('notes')).toBeNull();
    await publisher.drain();
    expect(publisher.current('notes')).toBeNull();
  });

  it('publishes future Markdown and deletions while excluding literal, prefix and hidden paths', async () => {
    for (const path of [
      'memory/accepted.md',
      'memory/private.md',
      'memory/scripts/leak.md',
      'memory/manifest/leak.md',
      'memory/.hidden.md',
      'memory/.private/nested.md',
    ]) {
      await mkdir(join(repo, path, '..'), { recursive: true });
      await writeFile(join(repo, path), '# ' + path);
    }
    git('add', '.');
    git('commit', '-m', 'source policy fixture');
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md', 'memory/'],
      excludePaths: ['memory/private.md', 'memory/scripts/', 'memory/manifest/', 'absent/'],
      excludeHiddenPaths: true,
    };
    publisher = new KnowledgePublisher({ root: join(root, 'policy'), sources: [source] });
    const worker = publisher as unknown as {
      git: (cwd: string, args: string[], binary?: boolean) => Promise<Buffer>;
    };
    const calls = vi.spyOn(worker, 'git');
    publisher.enqueue('notes');
    await publisher.drain();
    const first = publisher.current('notes')!;
    const manifest = JSON.parse(await readFile(join(first.directory, 'manifest.json'), 'utf8'));
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
      'AGENTS.md',
      'memory/accepted.md',
    ]);
    expect(manifest.excludePaths).toEqual(source.excludePaths);
    expect(manifest.excludeHiddenPaths).toBe(true);
    expect(manifest.sourceIdentity).toBe(
      createHash('sha256').update(JSON.stringify(source)).digest('hex'),
    );
    for (const path of [
      'memory/private.md',
      'memory/scripts/leak.md',
      'memory/manifest/leak.md',
      'memory/.hidden.md',
      'memory/.private/nested.md',
    ]) {
      await expect(access(join(first.directory, 'source', path))).rejects.toThrow();
      expect(
        calls.mock.calls.some(
          ([, args]) => args[0] === 'cat-file' && args[2] === git('rev-parse', 'main:' + path),
        ),
      ).toBe(false);
      expect(await readFile(join(first.directory, 'context.json'), 'utf8')).not.toContain(path);
    }
    await writeFile(join(repo, 'memory/future.md'), '# Newly accepted');
    await rm(join(repo, 'memory/accepted.md'));
    git('add', '.');
    git('commit', '-m', 'accepted addition and deletion');
    publisher.enqueue('notes');
    await publisher.drain();
    const second = publisher.current('notes')!;
    expect(second.revision).not.toBe(first.revision);
    expect(
      JSON.parse(await readFile(join(second.directory, 'manifest.json'), 'utf8')).files.map(
        (file: { path: string }) => file.path,
      ),
    ).toEqual(['AGENTS.md', 'memory/future.md']);
  });

  it('discovers optional instructions and context directories when added and permits their deletion', async () => {
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md'],
      optionalPaths: [
        'CLAUDE.md',
        'CONSTITUTION.md',
        'context/',
        'spoke/AGENTS.md',
        'spoke/context/',
      ],
      excludePaths: ['context/scripts/'],
      excludeHiddenPaths: true,
    };
    publisher = new KnowledgePublisher({ root: join(root, 'optional'), sources: [source] });
    publisher.enqueue('notes');
    await publisher.drain();
    const initial = publisher.current('notes')!;
    expect(
      JSON.parse(await readFile(join(initial.directory, 'manifest.json'), 'utf8')).optionalPaths,
    ).toEqual(source.optionalPaths);
    for (const path of [
      'CLAUDE.md',
      'context/accepted.md',
      'spoke/context/new.md',
      'context/scripts/leak.md',
      'context/.hidden.md',
    ]) {
      await mkdir(join(repo, path, '..'), { recursive: true });
      await writeFile(join(repo, path), '# ' + path);
    }
    git('add', '.');
    git('commit', '-m', 'new optional guidance');
    publisher.enqueue('notes');
    await publisher.drain();
    const added = publisher.current('notes')!;
    expect(
      JSON.parse(await readFile(join(added.directory, 'manifest.json'), 'utf8')).files.map(
        (file: { path: string }) => file.path,
      ),
    ).toEqual(['AGENTS.md', 'CLAUDE.md', 'context/accepted.md', 'spoke/context/new.md']);
    await rm(join(repo, 'CLAUDE.md'));
    await rm(join(repo, 'context'), { recursive: true });
    await rm(join(repo, 'spoke'), { recursive: true });
    git('add', '.');
    git('commit', '-m', 'remove optional guidance');
    publisher.enqueue('notes');
    await publisher.drain();
    const removed = publisher.current('notes')!;
    expect(removed.revision).not.toBe(added.revision);
    expect(
      JSON.parse(await readFile(join(removed.directory, 'manifest.json'), 'utf8')).files.map(
        (file: { path: string }) => file.path,
      ),
    ).toEqual(['AGENTS.md']);
  });

  it('rejects unsafe optional path configuration', async () => {
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md'],
      optionalPaths: ['../escape'],
    };
    expect(
      () => new KnowledgePublisher({ root: join(root, 'bad-optional'), sources: [source] }),
    ).toThrow('Explicit safe optional paths required');
  });
  it('excludes named segments at any depth before acquiring nested Markdown', async () => {
    for (const path of ['memory/accepted.md', 'memory/category/node_modules/private.md']) {
      await mkdir(join(repo, path, '..'), { recursive: true });
      await writeFile(join(repo, path), '# ' + path);
    }
    git('add', '.');
    git('commit', '-m', 'nested dependency fixture');
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md', 'memory/'],
      excludePathSegments: ['node_modules'],
    };
    publisher = new KnowledgePublisher({ root: join(root, 'segments'), sources: [source] });
    publisher.enqueue('notes');
    await publisher.drain();
    const selected = publisher.current('notes')!;
    const manifest = JSON.parse(await readFile(join(selected.directory, 'manifest.json'), 'utf8'));
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
      'AGENTS.md',
      'memory/accepted.md',
    ]);
    expect(manifest.excludePathSegments).toEqual(['node_modules']);
    await expect(
      access(join(selected.directory, 'source/memory/category/node_modules/private.md')),
    ).rejects.toThrow();
  });
  it.each(['', '.', '..', 'memory/node_modules', 'memory\\node_modules'])(
    'rejects unsafe excluded segment %j',
    async (segment) => {
      await publisher.close();
      const source = {
        id: 'notes',
        url: repo,
        ref: 'refs/heads/main',
        paths: ['AGENTS.md'],
        excludePathSegments: [segment],
      };
      expect(
        () => new KnowledgePublisher({ root: join(root, 'bad-segment'), sources: [source] }),
      ).toThrow('Explicit safe exclusion segments required');
    },
  );

  it('still requires mandatory coverage when optional Markdown exists', async () => {
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['absent.md'],
      optionalPaths: ['AGENTS.md'],
    };
    publisher = new KnowledgePublisher({
      root: join(root, 'required-with-optional'),
      sources: [source],
    });
    publisher.enqueue('notes');
    await publisher.drain();
    expect(publisher.current('notes')).toBeNull();
    expect(publisher.status('notes').error).toBeTruthy();
  });

  it.each(
    [
      ['../escape'],
      ['/absolute'],
      ['memory//'],
      ['memory/./'],
      ['memory\\escape'],
      [''],
      'memory/',
      [null],
    ].map((value) => [value]),
  )('rejects unsafe excludePaths %j', async (excludePaths) => {
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md'],
      excludePaths,
    };
    expect(
      () =>
        new KnowledgePublisher({
          root: join(root, 'invalid-exclusions'),
          sources: [source as unknown as KnowledgeSource],
        }),
    ).toThrow('Explicit safe exclusion paths required');
  });

  it('rejects non-boolean hidden-path policy', async () => {
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md'],
      excludeHiddenPaths: 'true',
    };
    expect(
      () =>
        new KnowledgePublisher({
          root: join(root, 'invalid-hidden'),
          sources: [source as unknown as KnowledgeSource],
        }),
    ).toThrow('Boolean hidden-path exclusion required');
  });

  it.each(['optionalPaths', 'excludePaths', 'excludePathSegments', 'excludeHiddenPaths'])(
    'invalidates cached source identity when %s changes',
    async (field) => {
      publisher.enqueue('notes');
      await publisher.drain();
      const old = publisher.current('notes')!;
      await publisher.close();
      const source = {
        id: 'notes',
        url: repo,
        ref: 'refs/heads/main',
        githubRepository: 'example/notes',
        paths: ['AGENTS.md'],
        [field]:
          field === 'excludeHiddenPaths'
            ? true
            : field === 'excludePathSegments'
              ? ['node_modules']
              : ['absent/'],
      };
      publisher = new KnowledgePublisher({ root: join(root, 'state'), sources: [source] });
      expect(publisher.current('notes')).toBeNull();
      await publisher.drain();
      expect(publisher.current('notes')!.directory).not.toBe(old.directory);
    },
  );

  it('rejects a hashed retained snapshot that violates its exclusion policy', async () => {
    await publisher.close();
    const source = {
      id: 'notes',
      url: repo,
      ref: 'refs/heads/main',
      paths: ['AGENTS.md'],
      excludePaths: ['AGENTS.md'],
    };
    // A self-consistent legacy snapshot is not admissible under a newly bound exclusion.
    publisher = new KnowledgePublisher({
      root: join(root, 'corrupted-policy'),
      sources: [{ ...source, excludePaths: [] }],
    });
    publisher.enqueue('notes');
    await publisher.drain();
    const selected = publisher.current('notes')!;
    const manifest = JSON.parse(await readFile(join(selected.directory, 'manifest.json'), 'utf8'));
    manifest.excludePaths = source.excludePaths;
    manifest.sourceIdentity = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    const raw = JSON.stringify(manifest);
    await writeFile(join(selected.directory, 'manifest.json'), raw);
    const verify = publisher as unknown as {
      verify: (publication: Publication, policy: KnowledgeSource) => Promise<boolean>;
    };
    expect(
      await verify.verify(
        { ...selected, manifestSha256: createHash('sha256').update(raw).digest('hex') },
        source,
      ),
    ).toBe(false);
  });

  it('finishes work enqueued for an earlier source during an active flight', async () => {
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'multi'),
      sources: ['notes', 'later'].map((id) => ({
        id,
        url: repo,
        ref: 'refs/heads/main',
        paths: ['AGENTS.md'],
      })),
    });
    const worker = publisher as unknown as {
      build: (source: KnowledgeSource) => Promise<Publication>;
    };
    const original = worker.build.bind(worker);
    let unblock = () => {};
    let reached = () => {};
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.spyOn(worker, 'build').mockImplementation(async (source) => {
      if (source.id === 'later') {
        reached();
        await gate;
      }
      return original(source);
    });
    publisher.enqueue('notes', 'first');
    publisher.enqueue('later', 'first');
    const first = publisher.drain();
    await entered;
    publisher.enqueue('notes', 'arrived-during-later');
    const barrier = publisher.drain();
    unblock();
    await Promise.all([first, barrier]);
    expect(publisher.status('notes').completed).toBe(2);
    expect(publisher.status('notes').requested).toBe(2);
  });

  it('publishes an annotated accepted tag and rejects invalid ref syntax', async () => {
    git('tag', '--no-sign', '-a', 'accepted', '-m', 'accepted knowledge');
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'tag'),
      sources: [{ id: 'notes', url: repo, ref: 'refs/tags/accepted', paths: ['AGENTS.md'] }],
    });
    publisher.enqueue('notes', 'tag');
    await publisher.drain();
    expect(publisher.current('notes')!.revision).toBe(git('rev-parse', 'main'));
    expect(
      () =>
        new KnowledgePublisher({
          root: join(root, 'invalid-ref'),
          sources: [{ id: 'notes', url: repo, ref: 'refs/heads/bad.lock', paths: ['AGENTS.md'] }],
        }),
    ).toThrow();
  });

  it('rejects workspace and symlink-parent placement before creating state', async () => {
    const workspace = join(root, 'user-workspace');
    await mkdir(workspace);
    const alias = join(root, 'alias');
    await symlink(workspace, alias, 'dir');
    for (const candidate of [join(workspace, 'state'), join(alias, 'state'), join(repo, 'state')]) {
      let invalid: KnowledgePublisher | undefined;
      try {
        expect(() => {
          invalid = new KnowledgePublisher({
            root: candidate,
            workspaceRoots: [workspace],
            sources: [
              {
                id: 'notes',
                url: 'https://example.com/notes.git',
                ref: 'refs/heads/main',
                paths: ['AGENTS.md'],
              },
            ],
          });
        }).toThrow();
        await expect(access(candidate)).rejects.toThrow();
      } finally {
        await invalid?.close();
      }
    }
  });

  it('preserves failure backoff across admission checks and bounds explicit retry', async () => {
    git('branch', '-m', 'main', 'gone');
    const worker = publisher as unknown as {
      build: (source: KnowledgeSource) => Promise<Publication>;
    };
    const build = vi.spyOn(worker, 'build');
    publisher.enqueue('notes', 'failed');
    await publisher.drain();
    const retryAt = publisher.status('notes').retry;
    for (let i = 0; i < 10; i++) {
      publisher.enqueue('notes', `admission-${i}`);
      await publisher.drain();
    }
    expect(publisher.status('notes').retry).toBe(retryAt);
    expect(build).toHaveBeenCalledTimes(1);
    expect(publisher.requestRetry('notes')).toBe(false);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(retryAt + 1);
    try {
      expect(publisher.requestRetry('notes')).toBe(true);
      await publisher.drain();
      expect(build).toHaveBeenCalledTimes(2);
      expect(publisher.requestRetry('notes')).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects symlinked state children before writing into a checkout', async () => {
    const sourceState = join(root, 'state', 'notes');
    await symlink(repo, sourceState, 'dir');
    publisher.enqueue('notes', 'unsafe-state');
    await publisher.drain();
    expect(publisher.current('notes')).toBeNull();
    await expect(access(join(repo, 'mirror.git'))).rejects.toThrow();
  });

  it('repairs unexpected files in a retained snapshot', async () => {
    publisher.enqueue('notes', 'first');
    await publisher.drain();
    const old = publisher.current('notes')!;
    await writeFile(join(old.directory, 'source', 'extra.md'), 'unaccepted knowledge');
    publisher.enqueue('notes', 'verify-all-files');
    await publisher.drain();
    expect(publisher.current('notes')!.directory).not.toBe(old.directory);
    await expect(
      access(join(publisher.current('notes')!.directory, 'source', 'extra.md')),
    ).rejects.toThrow();
  });

  it('publishes stable relative provenance when the private root contains quotes', async () => {
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'quoted"state'),
      sources: [{ id: 'notes', url: repo, ref: 'refs/heads/main', paths: ['AGENTS.md'] }],
    });
    publisher.enqueue('notes', 'quoted');
    await publisher.drain();
    const context = JSON.parse(
      await readFile(join(publisher.current('notes')!.directory, 'context.json'), 'utf8'),
    );
    expect(context.sources.length).toBeGreaterThan(0);
    expect(
      context.sources.every((source: { path: string }) => source.path.startsWith('source/')),
    ).toBe(true);
  });

  it('rejects symlinked SQLite files and sidecars before opening durable state', async () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const state = join(root, 'sqlite-' + (suffix || 'db'));
      await mkdir(state, { mode: 0o700 });
      const target = join(repo, 'external' + suffix);
      await writeFile(target, 'untouched');
      await symlink(target, join(state, 'publication.sqlite3' + suffix));
      let invalid: KnowledgePublisher | undefined;
      try {
        expect(() => {
          invalid = new KnowledgePublisher({
            root: state,
            sources: [{ id: 'notes', url: repo, ref: 'refs/heads/main', paths: ['AGENTS.md'] }],
          });
        }).toThrow('Unsafe SQLite state file');
        expect(await readFile(target, 'utf8')).toBe('untouched');
      } finally {
        await invalid?.close();
      }
    }
  });

  it('visits queued sources before reclaiming a continuously busy source', async () => {
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'fair'),
      sources: ['notes', 'later'].map((id) => ({
        id,
        url: repo,
        ref: 'refs/heads/main',
        paths: ['AGENTS.md'],
      })),
    });
    const worker = publisher as unknown as {
      build: (source: KnowledgeSource) => Promise<Publication>;
    };
    const original = worker.build.bind(worker);
    const order: string[] = [];
    vi.spyOn(worker, 'build').mockImplementation(async (source) => {
      order.push(source.id);
      if (source.id === 'notes' && order.length < 4) publisher.enqueue('notes');
      return original(source);
    });
    publisher.enqueue('notes');
    publisher.enqueue('later');
    await publisher.drain();
    expect(order.slice(0, 2)).toEqual(['notes', 'later']);
    expect(publisher.status('notes').completed).toBe(publisher.status('notes').requested);
  });

  it('finishes admission for its source while another source remains busy', async () => {
    await publisher.close();
    publisher = new KnowledgePublisher({
      root: join(root, 'admission'),
      sources: ['notes', 'later'].map((id) => ({
        id,
        url: repo,
        ref: 'refs/heads/main',
        paths: ['AGENTS.md'],
      })),
    });
    const worker = publisher as unknown as {
      build: (source: KnowledgeSource) => Promise<Publication>;
    };
    const original = worker.build.bind(worker);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(worker, 'build').mockImplementation(async (source) => {
      if (source.id === 'later') await gate;
      return original(source);
    });
    const app = Fastify();
    publicationRoutes(app, publisher, 'secret', 'token');
    publisher.enqueue('later');
    try {
      const result = await Promise.race([
        app.inject({
          method: 'POST',
          url: '/api/publications/notes/reconcile',
          headers: { authorization: 'Bearer token' },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      expect(result?.statusCode).toBe(200);
    } finally {
      release();
      await publisher.drain();
      await app.close();
    }
  });

  it('rejects redirects inside an existing Git mirror before fetching', async () => {
    publisher.enqueue('notes');
    await publisher.drain();
    const prior = publisher.current('notes');
    const objects = join(root, 'state', 'notes', 'mirror.git', 'objects');
    await rm(objects, { recursive: true });
    await symlink(repo, objects, 'dir');
    const worker = publisher as unknown as {
      git: (cwd: string, args: string[], binary?: boolean) => Promise<Buffer>;
    };
    const commands = vi.spyOn(worker, 'git');
    publisher.enqueue('notes');
    await publisher.drain();
    expect(commands).not.toHaveBeenCalled();
    expect(publisher.current('notes')).toEqual(prior);
    expect(publisher.status('notes').error).toBeTruthy();
  });

  it('binds the snapshot to its own fetch when another worker changes mirror refs', async () => {
    const accepted = git('rev-parse', 'main');
    git('checkout', '-b', 'other');
    await writeFile(join(repo, 'AGENTS.md'), '# Unaccepted branch\n\nWrong knowledge.\n');
    git('add', '.');
    git('commit', '-m', 'other branch');
    git('checkout', 'main');
    const worker = publisher as unknown as {
      git: (cwd: string, args: string[], binary?: boolean) => Promise<Buffer>;
    };
    const original = worker.git.bind(worker);
    vi.spyOn(worker, 'git').mockImplementation(async (cwd, args, binary) => {
      const result = await original(cwd, args, binary);
      if (args[0] === 'fetch')
        await original(cwd, [
          'fetch',
          '--force',
          '--',
          repo,
          'refs/heads/other:refs/publication/accepted',
        ]);
      return result;
    });
    publisher.enqueue('notes', 'isolated-fetch');
    await publisher.drain();
    expect(publisher.current('notes')!.revision).toBe(accepted);
  });
});
