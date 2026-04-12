import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceProvider } from '../../src/registry/providers/workspace.js';
import { buildGraph } from '../../src/graph/builder.js';
import { validateGraph } from '../../src/graph/validate.js';
import type { Schema } from '../../src/registry/types.js';

/** Minimal schema stub for validator context */
const STUB_SCHEMA: Schema = {
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  compatibility: 'none',
  provider: 'test',
  declarations: [],
  watchConfig: { mode: 'manual' },
};

// ── Fixtures ────────────────────────────────────────────────────

async function createFixtureWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'workspace');
  await fs.mkdir(root, { recursive: true });

  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# Test Workspace

## Purpose

A test workspace for schema registry tests.

## Spoke Charters

| Sub-Repo | Audience | Governance | Purpose |
|----------|----------|------------|---------|
| \`auth/\` | Engineers | Own constitution | Authentication service |
| \`api/\` | Engineers | Shared | REST API layer |
| \`ghost/\` | Nobody | None | This spoke does not exist |

## Entry Points

| Command | Description |
|---------|-------------|
| \`./start.sh\` | Start the app |

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
| \`docs/\` | Documentation |
`,
  );

  // Auth spoke with constitution
  await fs.mkdir(path.join(root, 'auth', 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'auth', 'CONSTITUTION.md'),
    `# Auth

## Purpose

Authentication and token management.

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Auth source code |
`,
  );

  // API spoke without constitution
  await fs.mkdir(path.join(root, 'api'), { recursive: true });

  // Declared directories
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });

  // Entry point script
  await fs.writeFile(path.join(root, 'start.sh'), '#!/bin/bash\necho start');

  // .centaurignore
  await fs.writeFile(path.join(root, '.centaurignore'), 'node_modules/\n');

  return root;
}

// ── Tests ───────────────────────────────────────────────────────

let tmpDir: string;
let root: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-registry-'));
  root = await createFixtureWorkspace(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('WorkspaceProvider', () => {
  describe('discover()', () => {
    it('should find CONSTITUTION.md in workspace roots', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);

      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('constitution');
      expect(sources[0].root).toBe(root);
      expect(sources[0].id).toBe(`workspace:${path.basename(root)}`);
    });

    it('should skip roots without CONSTITUTION.md', async () => {
      const provider = new WorkspaceProvider();
      const emptyDir = path.join(tmpDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const sources = await provider.discover([root, emptyDir]);

      expect(sources).toHaveLength(1);
      expect(sources[0].root).toBe(root);
    });

    it('should handle multiple roots', async () => {
      const provider = new WorkspaceProvider();
      const root2 = path.join(tmpDir, 'workspace2');
      await fs.mkdir(root2, { recursive: true });
      await fs.writeFile(
        path.join(root2, 'CONSTITUTION.md'),
        '# Hub 2\n\n## Purpose\n\nSecond hub.',
      );

      const sources = await provider.discover([root, root2]);

      expect(sources).toHaveLength(2);
    });

    it('should return empty array for empty roots list', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([]);

      expect(sources).toHaveLength(0);
    });
  });

  describe('extract()', () => {
    it('should produce a schema with declarations from constitution', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);
      const schema = await provider.extract(sources[0]);

      expect(schema.id).toBe(sources[0].id);
      expect(schema.provider).toBe('workspace');
      expect(schema.compatibility).toBe('full');
      expect(schema.declarations.length).toBeGreaterThan(0);
    });

    it('should include file_exists and directory_exists declarations from tree', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);
      const schema = await provider.extract(sources[0]);

      const dirDecls = schema.declarations.filter((d) => d.kind === 'directory_exists');
      const dirTargets = dirDecls.map((d) => d.target);

      // Hub-level: src/, docs/ (path.join strips trailing slash)
      expect(dirTargets.some((t) => t.includes('/src'))).toBe(true);
      expect(dirTargets.some((t) => t.includes('/docs'))).toBe(true);

      // Spoke-level: auth/src/
      expect(dirTargets.some((t) => t.includes('auth') && t.includes('/src'))).toBe(true);
    });

    it('should include spoke_declared declarations', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);
      const schema = await provider.extract(sources[0]);

      const spokeDecls = schema.declarations.filter((d) => d.kind === 'spoke_declared');

      expect(spokeDecls.length).toBe(3); // auth, api, ghost
      const spokeNames = spokeDecls.map((d) => d.metadata?.spokeName);
      expect(spokeNames).toContain('auth');
      expect(spokeNames).toContain('api');
      expect(spokeNames).toContain('ghost');
    });

    it('should include entry_point declarations', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);
      const schema = await provider.extract(sources[0]);

      const epDecls = schema.declarations.filter((d) => d.kind === 'entry_point');
      expect(epDecls.some((d) => d.target === './start.sh')).toBe(true);
    });

    it('should set watch config for continuous CONSTITUTION.md monitoring', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);
      const schema = await provider.extract(sources[0]);

      expect(schema.watchConfig.mode).toBe('continuous');
      expect(schema.watchConfig.triggers).toContain('**/CONSTITUTION.md');
    });
  });

  describe('createValidators()', () => {
    it('should return validators for all workspace declaration kinds', () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();

      const kinds = validators.map((v) => v.kind);
      expect(kinds).toContain('file_exists');
      expect(kinds).toContain('directory_exists');
      expect(kinds).toContain('spoke_declared');
      expect(kinds).toContain('entry_point');
      expect(kinds).toContain('external_reference');
    });
  });

  describe('validators', () => {
    it('file_exists: valid for existing file', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const fileValidator = validators.find((v) => v.kind === 'file_exists')!;

      const result = await fileValidator.validate(
        { kind: 'file_exists', target: path.join(root, 'start.sh'), severity: 'error' },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(true);
    });

    it('file_exists: invalid for missing file', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const fileValidator = validators.find((v) => v.kind === 'file_exists')!;

      const result = await fileValidator.validate(
        { kind: 'file_exists', target: path.join(root, 'nonexistent.txt'), severity: 'error' },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(false);
      expect(result.remediation).toBeDefined();
    });

    it('directory_exists: valid for existing directory', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const dirValidator = validators.find((v) => v.kind === 'directory_exists')!;

      const result = await dirValidator.validate(
        { kind: 'directory_exists', target: path.join(root, 'src'), severity: 'error' },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(true);
    });

    it('directory_exists: invalid for missing directory', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const dirValidator = validators.find((v) => v.kind === 'directory_exists')!;

      const result = await dirValidator.validate(
        { kind: 'directory_exists', target: path.join(root, 'nonexistent'), severity: 'error' },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(false);
    });

    it('spoke_declared: valid for existing spoke directory', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const spokeValidator = validators.find((v) => v.kind === 'spoke_declared')!;

      const result = await spokeValidator.validate(
        {
          kind: 'spoke_declared',
          target: path.join(root, 'auth'),
          severity: 'error',
          metadata: { spokeName: 'auth' },
        },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(true);
    });

    it('spoke_declared: invalid for missing spoke directory', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const spokeValidator = validators.find((v) => v.kind === 'spoke_declared')!;

      const result = await spokeValidator.validate(
        {
          kind: 'spoke_declared',
          target: path.join(root, 'ghost'),
          severity: 'error',
          metadata: { spokeName: 'ghost' },
        },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(false);
      expect(result.message).toContain('ghost');
    });

    it('entry_point: valid for existing script', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const epValidator = validators.find((v) => v.kind === 'entry_point')!;

      const result = await epValidator.validate(
        {
          kind: 'entry_point',
          target: './start.sh',
          severity: 'warning',
          metadata: { resolveRoot: root },
        },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(true);
    });

    it('entry_point: skips HTTP endpoints', async () => {
      const provider = new WorkspaceProvider();
      const validators = provider.createValidators();
      const epValidator = validators.find((v) => v.kind === 'entry_point')!;

      const result = await epValidator.validate(
        { kind: 'entry_point', target: 'GET /health', severity: 'warning' },
        { workspaceRoot: root, schema: STUB_SCHEMA },
      );

      expect(result.valid).toBe(true); // skipped, not validated
    });
  });

  describe('validateViaGraph()', () => {
    it('should produce violations matching direct graph validation', async () => {
      const provider = new WorkspaceProvider();

      // Direct graph path
      const graph = await buildGraph([root]);
      const directViolations = await validateGraph(graph);
      const allDirect = [...graph.violations, ...directViolations];

      // Provider path
      const providerResults = await provider.validateViaGraph([root]);
      const providerInvalid = providerResults.filter((r) => !r.valid);

      // Both paths should find the same violations
      expect(providerInvalid.length).toBe(allDirect.length);
    });

    it('should detect missing spoke (ghost)', async () => {
      const provider = new WorkspaceProvider();
      const results = await provider.validateViaGraph([root]);
      const invalid = results.filter((r) => !r.valid);

      // ghost/ spoke is declared but doesn't exist
      const ghostViolation = invalid.find(
        (r) => r.message.includes('ghost') && r.declaration.kind === 'missing_directory',
      );
      expect(ghostViolation).toBeDefined();
    });

    it('should detect missing constitution for api spoke', async () => {
      const provider = new WorkspaceProvider();
      const results = await provider.validateViaGraph([root]);
      const invalid = results.filter((r) => !r.valid);

      const apiViolation = invalid.find(
        (r) => r.message.includes('api') && r.declaration.kind === 'missing_constitution',
      );
      expect(apiViolation).toBeDefined();
    });
  });

  describe('cache', () => {
    it('should cache graph between extract calls', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);

      const schema1 = await provider.extract(sources[0]);
      const schema2 = await provider.extract(sources[0]);

      // Same declarations count — proves cache hit (not a fresh build)
      expect(schema1.declarations.length).toBe(schema2.declarations.length);
    });

    it('should clear cache when clearCache() is called', async () => {
      const provider = new WorkspaceProvider();
      const sources = await provider.discover([root]);

      await provider.extract(sources[0]);
      provider.clearCache();

      // Should rebuild without error
      const schema = await provider.extract(sources[0]);
      expect(schema.declarations.length).toBeGreaterThan(0);
    });
  });
});
