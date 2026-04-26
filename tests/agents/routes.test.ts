import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createServer } from '../../src/server/app.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import type { ContexGinServer } from '../../src/server/app.js';

// ── Fixtures ───────────────────────────────────────────────────

function agentDefinition(name: string, hubPath: string) {
  return `
kind: AgentDefinition
version: "0.1"

identity:
  name: ${name}
  description: Test agent ${name}
  mode: narrow

provider:
  default: gpt-4o

context:
  budget: 4000
  sources:
    hubs:
      - path: ${hubPath}
        spokes: []
  priority: []
  exclude: []
  profile: null

output:
  conventions:
    commit_style: conventional
    response_format: structured
  guides: []

governance:
  boundaries: []
  approval:
    required_for: []
    auto_allow:
      - Read

memory:
  scope: none
  vault: null
`;
}

async function createTestWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'workspace');
  await fs.mkdir(root, { recursive: true });

  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# Test Hub

## Purpose

A test workspace for agent route tests.

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
`,
  );

  return root;
}

// ── Tests ──────────────────────────────────────────────────────

describe('Agent Routes', () => {
  let tmpDir: string;
  let agentDir: string;
  let server: ContexGinServer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-agent-routes-'));
    agentDir = path.join(tmpDir, 'agents');
    await fs.mkdir(agentDir, { recursive: true });
  });

  afterEach(async () => {
    if (server) await server.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/agents', () => {
    it('returns empty list when no definitions loaded', async () => {
      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({ method: 'GET', url: '/api/agents' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.agents).toEqual([]);
    });

    it('lists loaded agent definitions', async () => {
      const workspace = await createTestWorkspace(tmpDir);
      await fs.writeFile(
        path.join(agentDir, 'test.yaml'),
        agentDefinition('test-agent', workspace),
      );

      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [workspace],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({ method: 'GET', url: '/api/agents' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].name).toBe('test-agent');
      expect(body.agents[0].provider).toBe('gpt-4o');
      expect(body.agents[0].budget).toBe(4000);
    });
  });

  describe('GET /api/agents/:name', () => {
    it('returns agent definition', async () => {
      const workspace = await createTestWorkspace(tmpDir);
      await fs.writeFile(
        path.join(agentDir, 'test.yaml'),
        agentDefinition('test-agent', workspace),
      );

      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [workspace],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({ method: 'GET', url: '/api/agents/test-agent' });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.kind).toBe('AgentDefinition');
      expect(body.identity.name).toBe('test-agent');
      expect(body.provider.default).toBe('gpt-4o');
    });

    it('returns 404 for unknown agent', async () => {
      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({ method: 'GET', url: '/api/agents/nonexistent' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/agents/:name/context', () => {
    it('compiles boot context for an agent', async () => {
      const workspace = await createTestWorkspace(tmpDir);
      await fs.writeFile(
        path.join(agentDir, 'test.yaml'),
        agentDefinition('test-agent', workspace),
      );

      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [workspace],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context',
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.agent).toBe('test-agent');
      expect(body.provider.default).toBe('gpt-4o');
      expect(body.boot).toBeDefined();
      expect(typeof body.boot.context).toBe('string');
      expect(typeof body.boot.tokens).toBe('number');
      expect(typeof body.boot.sources).toBe('number');
      expect(body.recipe).toBeDefined();
      expect(body.recipe.memory.scope).toBe('none');
      expect(body.recipe.output.conventions.commit_style).toBe('conventional');
    });

    it('returns 404 for unknown agent', async () => {
      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/nonexistent/context',
      });
      expect(response.statusCode).toBe(404);
    });

    it('accepts task query parameter', async () => {
      const workspace = await createTestWorkspace(tmpDir);
      await fs.writeFile(
        path.join(agentDir, 'test.yaml'),
        agentDefinition('test-agent', workspace),
      );

      server = await createServer({
        ...DEFAULT_CONFIG,
        roots: [workspace],
        dbPath: ':memory:',
        agentDefinitionPaths: [agentDir],
      });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/agents/test-agent/context?task=review+a+PR',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().agent).toBe('test-agent');
    });
  });
});
