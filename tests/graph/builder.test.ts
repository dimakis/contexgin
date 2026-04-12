import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildGraph } from '../../src/graph/builder.js';

// ── Fixtures ─────────────────────────────────────────────────────

async function createFixtureWorkspace(tmpDir: string): Promise<string> {
  const root = path.join(tmpDir, 'workspace');
  await fs.mkdir(root, { recursive: true });

  // Root constitution with spoke charters
  await fs.writeFile(
    path.join(root, 'CONSTITUTION.md'),
    `# Workspace

## Purpose

A test workspace for graph builder tests.

## Spoke Charters

| Sub-Repo | Audience | Governance | Purpose |
|----------|----------|------------|---------|
| \`auth/\` | Engineers | Own constitution | Authentication service |
| \`api/\` | Engineers | Shared | REST API layer |
| \`missing_spoke/\` | Nobody | None | This spoke directory doesn't exist |

## Entry Points

| Command | Description |
|---------|-------------|
| \`./run\` | Start the app |

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
| \`docs/\` | Documentation |
`,
  );

  // Auth spoke
  await fs.mkdir(path.join(root, 'auth'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'auth', 'CONSTITUTION.md'),
    `# Auth

## Purpose

Authentication and token management.

## Dependencies

- \`db\` — needs database access
- \`config\` — reads configuration

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Auth source code |
| \`tests/\` | Auth tests |
`,
  );

  // API spoke (no constitution)
  await fs.mkdir(path.join(root, 'api'), { recursive: true });

  // Undeclared directory
  await fs.mkdir(path.join(root, 'undeclared_dir'), { recursive: true });

  // Ignored directory
  await fs.mkdir(path.join(root, 'node_modules', 'foo'), { recursive: true });

  return root;
}

// ── Tests ────────────────────────────────────────────────────────

describe('buildGraph', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-builder-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('fixture workspace', () => {
    it('builds hub with correct metadata', async () => {
      const root = await createFixtureWorkspace(tmpDir);
      const graph = await buildGraph([root]);

      expect(graph.hubs).toHaveLength(1);
      expect(graph.hubs[0].name).toBe('workspace');
      expect(graph.hubs[0].path).toBe(root);
      expect(graph.hubs[0].constitution.purpose).toBe('A test workspace for graph builder tests.');
    });

    it('discovers declared spokes with constitutions', async () => {
      const root = await createFixtureWorkspace(tmpDir);
      const graph = await buildGraph([root]);

      const hub = graph.hubs[0];
      const auth = hub.spokes.find((s) => s.name === 'auth');
      expect(auth).toBeDefined();
      expect(auth!.constitution).not.toBeNull();
      expect(auth!.constitution!.purpose).toBe('Authentication and token management.');
      expect(auth!.parentId).toBe(root);
    });

    it('records violation for missing spoke constitution', async () => {
      const root = await createFixtureWorkspace(tmpDir);
      const graph = await buildGraph([root]);

      const hub = graph.hubs[0];
      const api = hub.spokes.find((s) => s.name === 'api');
      expect(api).toBeDefined();
      expect(api!.constitution).toBeNull();

      const missingConst = graph.violations.find(
        (v) => v.kind === 'missing_constitution' && v.location.includes('api'),
      );
      expect(missingConst).toBeDefined();
      expect(missingConst!.severity).toBe('warning');
    });

    it('records violation for missing spoke directory', async () => {
      const root = await createFixtureWorkspace(tmpDir);
      const graph = await buildGraph([root]);

      const missingDir = graph.violations.find(
        (v) => v.kind === 'missing_directory' && v.declared === 'missing_spoke/',
      );
      expect(missingDir).toBeDefined();
      expect(missingDir!.severity).toBe('error');
    });

    it('creates contains edges from hub to spokes', async () => {
      const root = await createFixtureWorkspace(tmpDir);
      const graph = await buildGraph([root]);

      const containsEdges = graph.edges.filter((e) => e.kind === 'contains');
      // auth and api (missing_spoke doesn't get an edge since dir doesn't exist)
      expect(containsEdges.length).toBeGreaterThanOrEqual(2);
    });

    it('creates dependency edges from spoke constitutions', async () => {
      const root = await createFixtureWorkspace(tmpDir);
      const graph = await buildGraph([root]);

      const depEdges = graph.edges.filter((e) => e.kind === 'depends_on');
      expect(depEdges.length).toBeGreaterThan(0);

      const dbDep = depEdges.find((e) => e.to.includes('db'));
      expect(dbDep).toBeDefined();
    });
  });

  describe('empty workspace', () => {
    it('records violation for missing root constitution', async () => {
      const emptyRoot = path.join(tmpDir, 'empty');
      await fs.mkdir(emptyRoot, { recursive: true });

      const graph = await buildGraph([emptyRoot]);
      expect(graph.hubs).toHaveLength(0);
      expect(graph.violations).toHaveLength(1);
      expect(graph.violations[0].kind).toBe('missing_constitution');
    });
  });

  describe('multiple roots', () => {
    it('builds hubs for each root', async () => {
      const root1 = await createFixtureWorkspace(tmpDir);
      const root2 = path.join(tmpDir, 'second');
      await fs.mkdir(root2, { recursive: true });
      await fs.writeFile(
        path.join(root2, 'CONSTITUTION.md'),
        `# Second\n## Purpose\nAnother workspace.\n`,
      );

      const graph = await buildGraph([root1, root2]);
      expect(graph.hubs).toHaveLength(2);
    });
  });

  describe('rich fixture workspace', () => {
    it('builds graph with many spokes and nested constitutions', async () => {
      const root = await createFixtureWorkspace(tmpDir);

      // Add more spokes to exercise the builder fully
      for (const name of ['cli', 'docs', 'lib']) {
        await fs.mkdir(path.join(root, name), { recursive: true });
      }
      // Add a spoke charter table entry for the new spokes
      const constitution = await fs.readFile(path.join(root, 'CONSTITUTION.md'), 'utf-8');
      await fs.writeFile(
        path.join(root, 'CONSTITUTION.md'),
        constitution.replace(
          "| `missing_spoke/` | Nobody | None | This spoke directory doesn't exist |",
          "| `missing_spoke/` | Nobody | None | This spoke directory doesn't exist |\n| `cli/` | Engineers | Shared | CLI tool |\n| `docs/` | Everyone | Shared | Docs site |\n| `lib/` | Engineers | Shared | Shared utils |",
        ),
      );
      // Give lib a constitution
      await fs.writeFile(
        path.join(root, 'lib', 'CONSTITUTION.md'),
        '# Lib\n\n## Purpose\n\nShared utilities.\n',
      );

      const graph = await buildGraph([root]);
      const hub = graph.hubs[0];

      expect(hub.spokes.length).toBeGreaterThanOrEqual(5);
      const withConstitutions = hub.spokes.filter((s) => s.constitution !== null);
      expect(withConstitutions.length).toBeGreaterThan(1);

      const containsEdges = graph.edges.filter((e) => e.kind === 'contains');
      expect(containsEdges.length).toBe(hub.spokes.length);

      // All violations should be well-formed
      for (const v of graph.violations) {
        expect(v.message.length).toBeGreaterThan(0);
        expect(v.kind).toBeDefined();
        expect(['error', 'warning', 'info']).toContain(v.severity);
      }
    });
  });
});
