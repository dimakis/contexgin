import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createServer } from '../../src/server/app.js';
import { DEFAULT_CONFIG, DEFAULT_COMPILE_BUDGET } from '../../src/server/types.js';
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

  describe('GET /api/agents', () => {
    it('returns empty list when no agent definitions exist', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({ method: 'GET', url: '/api/agents' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.agents).toEqual([]);
    });

    it('discovers agents from .agents/ directory', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({ method: 'GET', url: '/api/agents' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].name).toBe('test-agent');
    });
  });

  describe('GET /api/agents/:name/context', () => {
    it('compiles context for an agent', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
context:
  boot:
    tokenBudget: 4000
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context',
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.agent).toBe('test-agent');
      expect(body.boot).toBeDefined();
    });

    it('returns 404 for unknown agent', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/nonexistent/context',
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects workspace path outside allowed roots (path traversal)', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Attempt path traversal via workspace parameter
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context?workspace=/etc',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('not within allowed roots');
    });

    it('rejects workspace path traversal with ..', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Attempt path traversal using relative ..
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/agents/test-agent/context?workspace=${encodeURIComponent(root + '/../../../etc')}`,
      });

      expect(response.statusCode).toBe(403);
    });

    it('accepts workspace within allowed roots', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
context:
  boot:
    tokenBudget: 4000
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Use a subdirectory of root as workspace — should be allowed
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/agents/test-agent/context?workspace=${encodeURIComponent(path.join(root, 'svc'))}`,
      });

      // Should succeed (200) — svc/ is within root
      expect(response.statusCode).toBe(200);
    });

    it('rejects workspace via symlink escaping allowed roots', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`,
      );

      // Create a symlink inside the allowed root that points outside it
      const outsideDir = path.join(tmpDir, 'outside');
      await fs.mkdir(outsideDir, { recursive: true });
      const symlinkPath = path.join(root, 'escape-link');
      await fs.symlink(outsideDir, symlinkPath);

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Attempt to use the symlink as workspace — should be rejected
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/agents/test-agent/context?workspace=${encodeURIComponent(symlinkPath)}`,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 400 for invalid origin.source', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
context:
  boot:
    tokenBudget: 4000
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context?origin.source=invalid',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid origin.source');
    });

    it('accepts valid origin.source and threads it through compilation', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
context:
  boot:
    tokenBudget: 4000
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Chat origin should compile successfully (no-op resolver)
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context?origin.source=chat',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().agent).toBe('test-agent');
    });

    it('accepts telos origin with entityId', async () => {
      const root = await createTestWorkspace(tmpDir);
      const agentsDir = path.join(root, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'test-agent.yaml'),
        `identity:
  name: test-agent
  description: A test agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
context:
  boot:
    tokenBudget: 4000
`,
      );

      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });

      // Telos origin without a DB — should still compile (graceful degradation)
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context?origin.source=telos&origin.entityId=abc123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().agent).toBe('test-agent');
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

    it('compiles context for a configured hub root path', async () => {
      const root = await createTestWorkspace(tmpDir);
      await fs.writeFile(path.join(root, 'AGENTS.md'), '# Hub guidance\n\nROOT_GUIDANCE\n');
      await fs.writeFile(path.join(root, 'svc', 'AGENTS.md'), '# Private\n\nSPOKE_SECRET\n');
      await fs.mkdir(path.join(root, 'memory', 'Profile'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'memory', 'CONSTITUTION.md'),
        '# Memory\n\n## Purpose\n\nPrivate memory.\n\n## Confidentiality\n\n- Hard confidential; never expose outside this spoke.\n',
      );
      await fs.writeFile(path.join(root, 'memory', 'Profile', 'private.md'), 'PROFILE_SECRET\n');
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const hasMemorySpoke = server.state.graph!.hubs[0].spokes.some(
        (spoke) => spoke.name === 'memory',
      );
      expect(hasMemorySpoke).toBe(false);

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: root, budget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().spoke).toContain('workspace');
      expect(response.json().context).toContain('ROOT_GUIDANCE');
      expect(response.json().context).not.toContain('SPOKE_SECRET');
      expect(response.json().context).not.toContain('PROFILE_SECRET');
    });

    it('prefers an exact hub name over an ambiguous spoke name', async () => {
      const root = await createTestWorkspace(tmpDir);
      const constitutionPath = path.join(root, 'CONSTITUTION.md');
      const constitution = await fs.readFile(constitutionPath, 'utf8');
      await fs.writeFile(
        constitutionPath,
        constitution.replace(
          '| `svc/` | Engineers | Own constitution | Service layer |',
          '| `svc/` | Engineers | Own constitution | Service layer |\n' +
            '| `workspace/` | Engineers | Own constitution | Name collision |',
        ),
      );
      await fs.writeFile(path.join(root, 'AGENTS.md'), '# Hub guidance\n\nHUB_CONTEXT\n');
      await fs.mkdir(path.join(root, 'workspace'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'workspace', 'CONSTITUTION.md'),
        '# Collision spoke\n\n## Purpose\n\nAmbiguous spoke.\n',
      );
      await fs.writeFile(
        path.join(root, 'workspace', 'AGENTS.md'),
        '# Private spoke\n\nAMBIGUOUS_SPOKE_CONTEXT\n',
      );
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: path.basename(root), budget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().spoke).toBe(root);
      expect(response.json().context).toContain('HUB_CONTEXT');
      expect(response.json().context).not.toContain('AMBIGUOUS_SPOKE_CONTEXT');
    });

    it('rejects a hub name shared by multiple configured roots', async () => {
      const first = await createTestWorkspace(path.join(tmpDir, 'first'));
      const second = await createTestWorkspace(path.join(tmpDir, 'second'));
      const firstConstitution = path.join(first, 'CONSTITUTION.md');
      const firstContent = await fs.readFile(firstConstitution, 'utf8');
      await fs.writeFile(
        firstConstitution,
        firstContent.replace(
          '| `svc/` | Engineers | Own constitution | Service layer |',
          '| `svc/` | Engineers | Own constitution | Service layer |\n' +
            '| `workspace/` | Engineers | Own constitution | Colliding spoke |',
        ),
      );
      await fs.mkdir(path.join(first, 'workspace'));
      await fs.writeFile(
        path.join(first, 'workspace', 'CONSTITUTION.md'),
        '# Workspace spoke\n\n## Purpose\n\nName collision.\n',
      );
      await fs.writeFile(path.join(first, 'AGENTS.md'), '# First\n\nFIRST_HUB\n');
      await fs.writeFile(path.join(second, 'AGENTS.md'), '# Second\n\nSECOND_HUB\n');
      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [first, second],
        dbPath: ':memory:',
      });
      await server.rebuild();

      const ambiguous = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: 'workspace', budget: 4000 },
      });
      expect(ambiguous.statusCode).toBe(404);

      const exact = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: second, budget: 4000 },
      });
      expect(exact.statusCode).toBe(200);
      expect(exact.json().context).toContain('SECOND_HUB');
      expect(exact.json().context).not.toContain('FIRST_HUB');
    });

    it('excludes profiles when a declared memory spoke has no constitution', async () => {
      const root = await createTestWorkspace(tmpDir);
      const constitutionPath = path.join(root, 'CONSTITUTION.md');
      const constitution = await fs.readFile(constitutionPath, 'utf8');
      await fs.writeFile(
        constitutionPath,
        constitution.replace(
          '| `svc/` | Engineers | Own constitution | Service layer |',
          '| `svc/` | Engineers | Own constitution | Service layer |\n' +
            '| `memory/` | Private | Own constitution | Memory |',
        ),
      );
      await fs.writeFile(path.join(root, 'AGENTS.md'), '# Hub guidance\n\nHUB_CONTEXT\n');
      await fs.mkdir(path.join(root, 'memory', 'Profile'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'memory', 'Profile', 'private.md'),
        'UNATTESTED_PROFILE_SECRET\n',
      );
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const memory = server.state.graph!.hubs[0].spokes.find((spoke) => spoke.name === 'memory');
      expect(memory).toBeDefined();
      expect(memory!.constitution).toBeNull();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: root, budget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().context).toContain('HUB_CONTEXT');
      expect(response.json().context).not.toContain('UNATTESTED_PROFILE_SECRET');
    });

    it('excludes cursor rules from a hard-confidential declared cursor spoke', async () => {
      const root = await createTestWorkspace(tmpDir);
      const constitutionPath = path.join(root, 'CONSTITUTION.md');
      const constitution = await fs.readFile(constitutionPath, 'utf8');
      await fs.writeFile(
        constitutionPath,
        constitution.replace(
          '| `svc/` | Engineers | Own constitution | Service layer |',
          '| `svc/` | Engineers | Own constitution | Service layer |\n' +
            '| `.cursor/` | Private | Own constitution | Private rules |',
        ),
      );
      await fs.writeFile(path.join(root, 'AGENTS.md'), '# Hub guidance\n\nHUB_CONTEXT\n');
      await fs.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.cursor', 'CONSTITUTION.md'),
        '# Cursor\n\n## Confidentiality\n\n- Hard confidential; never expose outside this spoke.\n',
      );
      await fs.writeFile(
        path.join(root, '.cursor', 'rules', 'private.mdc'),
        '# PRIVATE_CURSOR_RULE\n',
      );
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const cursor = server.state.graph!.hubs[0].spokes.find((spoke) => spoke.name === '.cursor');
      expect(cursor?.confidentiality).toBe('hard');

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: root, budget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().context).toContain('HUB_CONTEXT');
      expect(response.json().context).not.toContain('PRIVATE_CURSOR_RULE');
    });

    it('excludes cursor rules from a constituted but undeclared cursor directory', async () => {
      const root = await createTestWorkspace(tmpDir);
      await fs.writeFile(path.join(root, 'AGENTS.md'), '# Hub guidance\n\nHUB_CONTEXT\n');
      await fs.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.cursor', 'CONSTITUTION.md'),
        '# Cursor\n\n## Confidentiality\n\n- Hard confidential; never expose outside this spoke.\n',
      );
      await fs.writeFile(
        path.join(root, '.cursor', 'rules', 'private.mdc'),
        '# UNDECLARED_CURSOR_SECRET\n',
      );
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      expect(server.state.graph!.hubs[0].spokes.some((spoke) => spoke.name === '.cursor')).toBe(
        false,
      );
      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: root, budget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().context).toContain('HUB_CONTEXT');
      expect(response.json().context).not.toContain('UNDECLARED_CURSOR_SECRET');
    });

    it('compiles an approved root that is absent from the graph', async () => {
      const root = path.join(tmpDir, 'root-without-constitution');
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, 'AGENTS.md'), '# Repository guidance\n\nROOT_ONLY\n');
      await fs.mkdir(path.join(root, 'private-child'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'private-child', 'AGENTS.md'),
        '# Private child\n\nCHILD_SECRET\n',
      );
      await fs.mkdir(path.join(root, 'memory', 'Profile'), { recursive: true });
      await fs.writeFile(path.join(root, 'memory', 'Profile', 'private.md'), 'PROFILE_SECRET\n');
      await fs.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.cursor', 'CONSTITUTION.md'),
        '# Cursor\n\n## Confidentiality\n\n- Hard confidential; never expose.\n',
      );
      await fs.writeFile(
        path.join(root, '.cursor', 'rules', 'private.mdc'),
        '# GRAPHLESS_CURSOR_SECRET\n',
      );
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: root, budget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().spoke).toBe(root);
      expect(response.json().context).toContain('ROOT_ONLY');
      expect(response.json().context).not.toContain('CHILD_SECRET');
      expect(response.json().context).not.toContain('PROFILE_SECRET');
      expect(response.json().context).not.toContain('GRAPHLESS_CURSOR_SECRET');
    });

    it('rejects a configured root that does not exist', async () => {
      const missingRoot = path.join(tmpDir, 'missing-root');
      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [missingRoot],
        dbPath: ':memory:',
      });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: missingRoot, budget: 4000 },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Workspace not found');
    });

    it('rejects a graph-backed hub that disappears after rebuild', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      await fs.rm(root, { recursive: true });

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: root, budget: 4000 },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Workspace not found');
    });

    it('uses DEFAULT_COMPILE_BUDGET when no budget is provided', async () => {
      const root = await createTestWorkspace(tmpDir);
      server = await createServer({ ...DEFAULT_CONFIG, roots: [root], dbPath: ':memory:' });
      await server.rebuild();

      const response = await server.app.inject({
        method: 'POST',
        url: '/compile',
        payload: { spoke: 'svc' },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.tokens).toBeLessThanOrEqual(DEFAULT_COMPILE_BUDGET);
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

    it('compile returns typed nodes', async () => {
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
      expect(body.nodes).toBeDefined();
    });
  });
});
