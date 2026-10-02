import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { KnowledgePublisher } from '../../src/server/publication/publisher.js';
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
    await publisher.drain();
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
});
