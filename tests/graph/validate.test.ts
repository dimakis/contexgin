import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildGraph } from '../../src/graph/builder.js';
import { validateGraph } from '../../src/graph/validate.js';

// ── Fixture ──────────────────────────────────────────────────────

async function createValidWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'workspace');

  // Create hub with valid structure
  await fs.mkdir(path.join(root, 'auth', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'api', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });

  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# Workspace

## Purpose

A valid test workspace.

## Spoke Charters

| Sub-Repo | Audience | Governance | Purpose |
|----------|----------|------------|---------|
| \`auth/\` | Engineers | Own | Auth service |
| \`api/\` | Engineers | Shared | API layer |

## Entry Points

| Command | Description |
|---------|-------------|
| \`./run.sh\` | Start the app |

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
| \`docs/\` | Documentation |
`,
  );

  // Create entry point file
  await fs.writeFile(path.join(root, 'run.sh'), '#!/bin/bash\necho hello');

  // Auth spoke with constitution
  await fs.writeFile(
    path.join(root, 'auth', 'CONSTITUTION.md'),
    `# Auth

## Purpose

Authentication.

## Dependencies

- api — needs API client

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Auth source |
`,
  );

  // API spoke with constitution
  await fs.writeFile(
    path.join(root, 'api', 'CONSTITUTION.md'),
    `# API

## Purpose

REST API.

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | API source |
`,
  );

  return root;
}

// ── Tests ────────────────────────────────────────────────────────

describe('validateGraph', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-validate-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Level 1: Structural', () => {
    it('reports no violations for valid workspace', async () => {
      const root = await createValidWorkspace(tmpDir);
      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      // Should have zero structural violations
      const structural = violations.filter(
        (v) => v.kind === 'missing_directory' || v.kind === 'missing_file',
      );
      expect(structural).toHaveLength(0);
    });

    it('reports missing declared directory', async () => {
      const root = await createValidWorkspace(tmpDir);
      // Remove a declared directory
      await fs.rm(path.join(root, 'docs'), { recursive: true });

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const missing = violations.find(
        (v) => v.kind === 'missing_directory' && v.declared === 'docs/',
      );
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe('error');
    });

    it('reports undeclared directory', async () => {
      const root = await createValidWorkspace(tmpDir);
      // Create an undeclared directory
      await fs.mkdir(path.join(root, 'secret_stuff'));

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const undeclared = violations.find(
        (v) => v.kind === 'undeclared_directory' && v.actual === 'secret_stuff/',
      );
      expect(undeclared).toBeDefined();
      expect(undeclared!.severity).toBe('info');
    });

    it('does not report ignored directories as undeclared', async () => {
      const root = await createValidWorkspace(tmpDir);
      // node_modules is in default ignore list
      await fs.mkdir(path.join(root, 'node_modules'));

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const undeclared = violations.filter((v) => v.kind === 'undeclared_directory');
      const nodeModules = undeclared.find((v) => v.actual === 'node_modules/');
      expect(nodeModules).toBeUndefined();
    });

    it('does not report dotfiles as undeclared', async () => {
      const root = await createValidWorkspace(tmpDir);
      await fs.mkdir(path.join(root, '.git'));

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const dotGit = violations.find(
        (v) => v.kind === 'undeclared_directory' && v.actual === '.git/',
      );
      expect(dotGit).toBeUndefined();
    });
  });

  describe('Level 2: Relational', () => {
    it('reports missing entry point', async () => {
      const root = await createValidWorkspace(tmpDir);
      // Remove the entry point
      await fs.rm(path.join(root, 'run.sh'));

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const stale = violations.find(
        (v) => v.kind === 'stale_reference' && v.declared === './run.sh',
      );
      expect(stale).toBeDefined();
    });

    it('does not flag HTTP endpoint entry points', async () => {
      const root = path.join(tmpDir, 'httpws');
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, 'CONSTITUTION.md'),
        `# HTTP Service

## Purpose

A web service.

## Entry Points

| Command | Description |
|---------|-------------|
| \`GET /health\` | Health check |
| \`POST /webhook\` | Webhook receiver |
`,
      );

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const staleRefs = violations.filter((v) => v.kind === 'stale_reference');
      expect(staleRefs).toHaveLength(0);
    });

    it('does not flag system commands as stale references', async () => {
      const root = path.join(tmpDir, 'syscmd');
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, 'CONSTITUTION.md'),
        `# Service

## Purpose

A service with system commands.

## Entry Points

| Command | Description |
|---------|-------------|
| \`docker compose up\` | Start containers |
| \`npm test\` | Run tests |
| \`node server.js\` | Start server |
`,
      );

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const staleRefs = violations.filter((v) => v.kind === 'stale_reference');
      expect(staleRefs).toHaveLength(0);
    });

    it('validates spoke entry points relative to spoke root', async () => {
      const root = await createValidWorkspace(tmpDir);
      // Add entry point to auth spoke constitution
      await fs.writeFile(
        path.join(root, 'auth', 'CONSTITUTION.md'),
        `# Auth

## Purpose

Authentication.

## Entry Points

| Command | Description |
|---------|-------------|
| \`./auth.sh\` | Start auth service |

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Auth source |
`,
      );
      // Entry point doesn't exist — should flag it relative to spoke, not hub
      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const stale = violations.find(
        (v) => v.kind === 'stale_reference' && v.declared === './auth.sh',
      );
      expect(stale).toBeDefined();
      expect(stale!.location).toContain('auth');
    });

    it('does not flag existing spoke entry points', async () => {
      const root = await createValidWorkspace(tmpDir);
      await fs.writeFile(
        path.join(root, 'auth', 'CONSTITUTION.md'),
        `# Auth

## Purpose

Authentication.

## Entry Points

| Command | Description |
|---------|-------------|
| \`./auth.sh\` | Start auth service |

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Auth source |
`,
      );
      // Create the entry point file in the spoke root
      await fs.writeFile(path.join(root, 'auth', 'auth.sh'), '#!/bin/bash\necho auth');

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const stale = violations.find(
        (v) => v.kind === 'stale_reference' && v.declared === './auth.sh',
      );
      expect(stale).toBeUndefined();
    });

    it('reports broken spoke dependency', async () => {
      const root = await createValidWorkspace(tmpDir);
      // Auth depends on "api" which exists, but let's add a broken dep
      // by modifying the auth constitution to depend on "nonexistent"
      await fs.writeFile(
        path.join(root, 'auth', 'CONSTITUTION.md'),
        `# Auth

## Purpose

Auth.

## Dependencies

- nonexistent_spoke — needs something that doesn't exist

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Auth source |
`,
      );

      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const broken = violations.find(
        (v) => v.kind === 'broken_dependency' && v.declared.includes('nonexistent'),
      );
      expect(broken).toBeDefined();
    });
  });

  describe('full validation pass on fixture workspace', () => {
    it('produces well-formed violations with no false positives', async () => {
      const root = await createValidWorkspace(tmpDir);
      const graph = await buildGraph([root]);
      const violations = await validateGraph(graph);

      const allViolations = [...graph.violations, ...violations];

      // All violations should have non-empty messages and valid kinds
      for (const v of allViolations) {
        expect(v.message.length).toBeGreaterThan(0);
        expect(v.kind).toBeDefined();
        expect(['error', 'warning', 'info']).toContain(v.severity);
      }

      // A valid workspace should have no structural errors
      const structural = allViolations.filter(
        (v) =>
          v.severity === 'error' && (v.kind === 'missing_directory' || v.kind === 'missing_file'),
      );
      expect(structural).toHaveLength(0);
    });
  });
});
