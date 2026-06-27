import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createServer } from '../../src/server/app.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import type { ContexGinServer } from '../../src/server/app.js';

// Mock child_process.execFile to avoid needing real Python/git
vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], opts: unknown, cb?: (...args: unknown[]) => void) => {
    // Support both callback and promisified forms
    const callback = cb ?? opts;
    if (typeof callback === 'function') {
      if (typeof cmd === 'string' && cmd.includes('python')) {
        const script = (args as string[])[0] ?? '';
        if (script.includes('crawl.py')) {
          callback(null, { stdout: 'Crawled 42 artifacts (whole-doc):\n', stderr: '' });
        } else {
          callback(null, { stdout: 'Saved 42 embeddings, dim=384\n', stderr: '' });
        }
      } else {
        // git pull
        callback(null, { stdout: 'Already up to date.\n', stderr: '' });
      }
    }
  }),
}));

async function createMgmtWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'mgmt');
  await fs.mkdir(root, { recursive: true });

  // Minimal CONSTITUTION.md so the server can build a graph
  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# mgmt\n\n## Purpose\n\nTest workspace.\n`,
  );

  // knowledge_space directory with scripts
  const ksDir = path.join(root, 'knowledge_space');
  await fs.mkdir(ksDir, { recursive: true });
  await fs.writeFile(path.join(ksDir, 'crawl.py'), '# stub');
  await fs.writeFile(path.join(ksDir, 'embed.py'), '# stub');

  // .venv/bin/python stub
  const venvBin = path.join(root, '.venv', 'bin');
  await fs.mkdir(venvBin, { recursive: true });
  await fs.writeFile(path.join(venvBin, 'python'), '#!/bin/sh\n', { mode: 0o755 });

  return root;
}

describe('POST /api/knowledge-space/rebuild', () => {
  let tmpDir: string;
  let server: ContexGinServer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-ks-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) await server.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 200 with artifact count on successful rebuild', async () => {
    const root = await createMgmtWorkspace(tmpDir);
    server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/knowledge-space/rebuild',
      payload: { trigger: 'test' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.artifact_count).toBe(42);
    expect(body.duration_ms).toBeGreaterThanOrEqual(0);
    expect(body.trigger).toBe('test');
    expect(body.root).toBe(root);
  });

  it('uses "manual" as default trigger', async () => {
    const root = await createMgmtWorkspace(tmpDir);
    server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/knowledge-space/rebuild',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().trigger).toBe('manual');
  });

  it('returns 404 when no mgmt root found', async () => {
    // Create a non-mgmt workspace
    const root = path.join(tmpDir, 'other-project');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'CONSTITUTION.md'), '# Other\n\n## Purpose\n\nNot mgmt.\n');

    server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/knowledge-space/rebuild',
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('No mgmt workspace root');
  });

  it('returns 404 when knowledge_space directory missing', async () => {
    const root = path.join(tmpDir, 'mgmt');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'CONSTITUTION.md'), '# mgmt\n\n## Purpose\n\nTest.\n');
    // No knowledge_space directory

    server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/knowledge-space/rebuild',
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('knowledge_space directory not found');
  });

  it('records build in store on success', async () => {
    const root = await createMgmtWorkspace(tmpDir);
    server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

    await server.app.inject({
      method: 'POST',
      url: '/api/knowledge-space/rebuild',
      payload: { trigger: 'push:dimakis' },
    });

    const builds = server.store.getBuilds(5);
    const ksBuild = builds.find((b) => b.trigger.startsWith('knowledge-space:'));
    expect(ksBuild).toBeDefined();
    expect(ksBuild!.trigger).toBe('knowledge-space:push:dimakis');
    expect(ksBuild!.success).toBe(true);
  });

  it('records build in store on failure', async () => {
    const root = await createMgmtWorkspace(tmpDir);
    server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

    // Make execFile fail for Python calls
    const { execFile } = await import('node:child_process');
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(((
      cmd: string,
      args: string[],
      opts: unknown,
      cb?: (...args: unknown[]) => void,
    ) => {
      const callback = cb ?? opts;
      if (typeof callback === 'function') {
        if (typeof cmd === 'string' && cmd.includes('python')) {
          callback(new Error('Python not found'), { stdout: '', stderr: '' });
        } else {
          callback(null, { stdout: 'Already up to date.\n', stderr: '' });
        }
      }
    }) as typeof execFile);

    const response = await server.app.inject({
      method: 'POST',
      url: '/api/knowledge-space/rebuild',
      payload: { trigger: 'test-failure' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().status).toBe('error');

    const builds = server.store.getBuilds(5);
    const ksBuild = builds.find((b) => b.trigger === 'knowledge-space:test-failure');
    expect(ksBuild).toBeDefined();
    expect(ksBuild!.success).toBe(false);
  });
});
