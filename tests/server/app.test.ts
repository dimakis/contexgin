import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createServer } from '../../src/server/app.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import type { ContexGinServer } from '../../src/server/app.js';

// ── Fixture ─────────────────────────────────────────────────────

async function createTestWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'workspace');
  await fs.mkdir(root, { recursive: true });

  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# Test Hub

## Purpose

A test workspace for server tests.

## Spoke Charters

| Sub-Repo | Audience | Governance | Purpose |
|----------|----------|------------|---------|
| \`svc/\` | Engineers | Own constitution | Service layer |

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
`,
  );

  await fs.mkdir(path.join(root, 'svc'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'svc', 'CONSTITUTION.md'),
    `# Service

## Purpose

Service spoke for testing.
`,
  );

  await fs.mkdir(path.join(root, 'src'), { recursive: true });

  return root;
}

/**
 * Creates a test workspace with Documentation Contracts that will
 * produce doc-consistency violations (claimed count doesn't match reality).
 */
async function createDocContractWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'doc-workspace');
  await fs.mkdir(root, { recursive: true });

  // CONSTITUTION.md with a Documentation Contracts table
  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# Doc Contract Hub

## Purpose

A workspace for testing doc-consistency via /validate.

## Documentation Contracts

| Document  | Section | Claim | Strategy | Pattern        | Path |
| --------- | ------- | ----- | -------- | -------------- | ---- |
| README.md | Tools   | count | glob     | src/tools/*.ts | .    |
`,
  );

  // README.md claims 5 scripts, but we only create 2
  await fs.writeFile(
    path.join(root, 'README.md'),
    `# Doc Contract Hub

## Tools

This workspace ships 5 scripts for automation.
`,
  );

  await fs.mkdir(path.join(root, 'src', 'tools'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'tools', 'lint.ts'), '');
  await fs.writeFile(path.join(root, 'src', 'tools', 'fmt.ts'), '');

  return root;
}

// ── Tests ───────────────────────────────────────────────────────

describe('ContexGin Server', () => {
  let tmpDir: string;
  let server: ContexGinServer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-server-'));
  });

  afterEach(async () => {
    if (server) await server.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('createServer', () => {
    it('creates a server with initial null graph', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      expect(server.state.graph).toBeNull();
      expect(server.state.lastBuild).toBeNull();
      expect(server.state.rebuilding).toBe(false);
    });

    it('rebuilds graph from roots', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      await server.rebuild();

      expect(server.state.graph).not.toBeNull();
      expect(server.state.graph!.hubs.length).toBe(1);
      expect(server.state.lastBuild).toBeInstanceOf(Date);
    });

    it('serializes concurrent rebuild calls', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Fire two rebuilds concurrently — both should resolve without error
      const [r1, r2] = await Promise.allSettled([server.rebuild(), server.rebuild()]);

      expect(r1.status).toBe('fulfilled');
      expect(r2.status).toBe('fulfilled');
      expect(server.state.graph).not.toBeNull();
      expect(server.state.rebuilding).toBe(false);
    });
  });

  describe('GET /health', () => {
    it('returns status before build', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({ method: 'GET', url: '/health' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.hubs).toBe(0);
      expect(body.lastBuild).toBeNull();
    });

    it('returns graph info after build', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({ method: 'GET', url: '/health' });
      const body = response.json();

      expect(body.status).toBe('ok');
      expect(body.hubs).toBe(1);
      expect(body.spokes).toBeGreaterThanOrEqual(1);
      expect(body.lastBuild).toBeTruthy();
      expect(body.violations).toBeDefined();
      expect(typeof body.violations.errors).toBe('number');
      expect(typeof body.violations.warnings).toBe('number');
      expect(typeof body.violations.info).toBe('number');
    });
  });

  describe('POST /validate', () => {
    it('validates workspace roots', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'POST',
        url: '/validate',
        payload: { roots: [root] },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.summary).toBeDefined();
      expect(body.summary.hubs).toBe(1);
      expect(body.violations).toBeDefined();
    });

    it('uses server roots when none provided', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'POST',
        url: '/validate',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary.hubs).toBe(1);
    });

    it('includes doc-consistency violations when contracts are present', async () => {
      const root = await createDocContractWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'POST',
        url: '/validate',
        payload: { roots: [root] },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      // The README claims 5 scripts but only 2 exist → should produce a warning
      expect(body.summary.warnings).toBeGreaterThanOrEqual(1);
      const docViolation = body.violations.find(
        (v: { message: string }) => v.message.includes('claims 5') && v.message.includes('found 2'),
      );
      expect(docViolation).toBeDefined();
    });

    it('returns 400 when no roots available', async () => {
      server = await createServer({ ...DEFAULT_CONFIG, roots: [], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'POST',
        url: '/validate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /graph', () => {
    it('returns 503 before build', async () => {
      server = await createServer({ ...DEFAULT_CONFIG, roots: [], dbPath: ':memory:' });

      const response = await server.app.inject({ method: 'GET', url: '/graph' });
      expect(response.statusCode).toBe(503);
    });

    it('returns graph after build', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({ method: 'GET', url: '/graph' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.hubs).toHaveLength(1);
      expect(body.hubs[0].name).toBe('workspace');
      expect(body.hubs[0].spokes.length).toBeGreaterThanOrEqual(1);
    });

    it('returns single hub by name', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({ method: 'GET', url: '/graph/workspace' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.hubs).toHaveLength(1);
    });

    it('returns 404 for unknown hub', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({ method: 'GET', url: '/graph/nonexistent' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /compile', () => {
    it('returns 503 before build', async () => {
      server = await createServer({ ...DEFAULT_CONFIG, roots: [], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: 'svc' },
      });
      expect(response.statusCode).toBe(503);
    });

    it('compiles context for a spoke', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: 'svc', budget: 4000 },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.spoke).toContain('svc');
      expect(body.tokens).toBeGreaterThanOrEqual(0);

      // Adapter pipeline returns typed nodes
      expect(body.nodes).toBeDefined();
      expect(Array.isArray(body.nodes)).toBe(true);
      if (body.nodes.length > 0) {
        const node = body.nodes[0];
        expect(node).toHaveProperty('id');
        expect(node).toHaveProperty('type');
        expect(node).toHaveProperty('tier');
        expect(node).toHaveProperty('content');
        expect(node).toHaveProperty('origin');
        expect(node).toHaveProperty('tokenEstimate');
      }
    });

    it('returns 404 for unknown spoke', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: 'nonexistent' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when spoke field missing', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('legacy flag uses legacy pipeline without nodes', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: 'svc', budget: 4000, legacy: true },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.spoke).toContain('svc');
      expect(body.tokens).toBeGreaterThanOrEqual(0);
      // Legacy pipeline does not return typed nodes
      expect(body.nodes).toBeUndefined();
    });
  });
});
