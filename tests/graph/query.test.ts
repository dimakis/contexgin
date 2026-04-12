import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { HubGraph, Hub, Spoke, Dependency } from '../../src/graph/types.js';
import {
  resolveReference,
  traverseDependencies,
  isAccessible,
  findSpoke,
  getExternals,
} from '../../src/graph/query.js';
import { buildGraph } from '../../src/graph/builder.js';

// ── Test Helpers ─────────────────────────────────────────────────

function makeGraph(hubs: Hub[], edges: Dependency[] = []): HubGraph {
  return { hubs, edges, violations: [] };
}

function makeSpoke(overrides: Partial<Spoke> & { id: string; name: string }): Spoke {
  return {
    path: `/workspace/${overrides.name}`,
    relativePath: overrides.name,
    parentId: '/workspace',
    constitution: null,
    children: [],
    confidentiality: 'none',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('resolveReference', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-query-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves child path within spoke', async () => {
    // Create filesystem structure
    const spokeDir = path.join(tmpDir, 'auth');
    await fs.mkdir(path.join(spokeDir, 'src'), { recursive: true });

    const spoke = makeSpoke({ id: `${tmpDir}/auth`, name: 'auth', path: spokeDir });
    const hub: Hub = {
      id: tmpDir,
      path: tmpDir,
      name: 'workspace',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [spoke],
      externals: [],
    };
    const graph = makeGraph([hub]);

    const result = await resolveReference(graph, spoke.id, 'src/');
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('child');
    expect(result!.absolutePath).toBe(path.join(spokeDir, 'src'));
  });

  it('resolves sibling spoke', async () => {
    const authDir = path.join(tmpDir, 'auth');
    const dbDir = path.join(tmpDir, 'db');
    await fs.mkdir(authDir, { recursive: true });
    await fs.mkdir(dbDir, { recursive: true });

    const auth = makeSpoke({ id: `${tmpDir}/auth`, name: 'auth', path: authDir });
    const db = makeSpoke({ id: `${tmpDir}/db`, name: 'db', path: dbDir });
    const hub: Hub = {
      id: tmpDir,
      path: tmpDir,
      name: 'workspace',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [auth, db],
      externals: [],
    };
    const graph = makeGraph([hub]);

    const result = await resolveReference(graph, auth.id, 'db');
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('sibling');
    expect(result!.resolvedIn).toBe(db.id);
  });

  it('resolves hub root path', async () => {
    const authDir = path.join(tmpDir, 'auth');
    const docsDir = path.join(tmpDir, 'docs');
    await fs.mkdir(authDir, { recursive: true });
    await fs.mkdir(docsDir, { recursive: true });

    const auth = makeSpoke({ id: `${tmpDir}/auth`, name: 'auth', path: authDir });
    const hub: Hub = {
      id: tmpDir,
      path: tmpDir,
      name: 'workspace',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [auth],
      externals: [],
    };
    const graph = makeGraph([hub]);

    const result = await resolveReference(graph, auth.id, 'docs');
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('hub_root');
  });

  it('returns null for unresolvable reference', async () => {
    const auth = makeSpoke({ id: `${tmpDir}/auth`, name: 'auth', path: path.join(tmpDir, 'auth') });
    await fs.mkdir(auth.path, { recursive: true });
    const hub: Hub = {
      id: tmpDir,
      path: tmpDir,
      name: 'workspace',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [auth],
      externals: [],
    };
    const graph = makeGraph([hub]);

    const result = await resolveReference(graph, auth.id, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('traverseDependencies', () => {
  it('finds direct dependencies', () => {
    const auth = makeSpoke({ id: '/ws/auth', name: 'auth' });
    const db = makeSpoke({ id: '/ws/db', name: 'db' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [auth, db],
      externals: [],
    };

    const edges: Dependency[] = [{ from: '/ws/auth', to: '/ws/db', kind: 'depends_on' }];
    const graph = makeGraph([hub], edges);

    const result = traverseDependencies(graph, '/ws/auth');
    expect(result.spokes).toHaveLength(1);
    expect(result.spokes[0].name).toBe('db');
    expect(result.hasCycle).toBe(false);
  });

  it('finds transitive dependencies', () => {
    const a = makeSpoke({ id: '/ws/a', name: 'a' });
    const b = makeSpoke({ id: '/ws/b', name: 'b' });
    const c = makeSpoke({ id: '/ws/c', name: 'c' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [a, b, c],
      externals: [],
    };

    const edges: Dependency[] = [
      { from: '/ws/a', to: '/ws/b', kind: 'depends_on' },
      { from: '/ws/b', to: '/ws/c', kind: 'depends_on' },
    ];
    const graph = makeGraph([hub], edges);

    const result = traverseDependencies(graph, '/ws/a');
    expect(result.spokes).toHaveLength(2);
    expect(result.hasCycle).toBe(false);
  });

  it('detects cycles', () => {
    const a = makeSpoke({ id: '/ws/a', name: 'a' });
    const b = makeSpoke({ id: '/ws/b', name: 'b' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [a, b],
      externals: [],
    };

    const edges: Dependency[] = [
      { from: '/ws/a', to: '/ws/b', kind: 'depends_on' },
      { from: '/ws/b', to: '/ws/a', kind: 'depends_on' },
    ];
    const graph = makeGraph([hub], edges);

    const result = traverseDependencies(graph, '/ws/a');
    expect(result.hasCycle).toBe(true);
  });

  it('returns empty for spoke with no dependencies', () => {
    const a = makeSpoke({ id: '/ws/a', name: 'a' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [a],
      externals: [],
    };
    const graph = makeGraph([hub]);

    const result = traverseDependencies(graph, '/ws/a');
    expect(result.spokes).toHaveLength(0);
    expect(result.hasCycle).toBe(false);
  });
});

describe('isAccessible', () => {
  it('allows access with no boundary', () => {
    const a = makeSpoke({ id: '/ws/a', name: 'a' });
    const b = makeSpoke({ id: '/ws/b', name: 'b' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [a, b],
      externals: [],
    };
    const graph = makeGraph([hub]);

    expect(isAccessible(graph, '/ws/a', '/ws/b')).toBe(true);
  });

  it('blocks access to hard confidential spoke', () => {
    const a = makeSpoke({ id: '/ws/a', name: 'a' });
    const secret = makeSpoke({ id: '/ws/secret', name: 'secret', confidentiality: 'hard' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [a, secret],
      externals: [],
    };
    const graph = makeGraph([hub]);

    expect(isAccessible(graph, '/ws/a', '/ws/secret')).toBe(false);
  });

  it('allows self-access to hard confidential spoke', () => {
    const secret = makeSpoke({ id: '/ws/secret', name: 'secret', confidentiality: 'hard' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [secret],
      externals: [],
    };
    const graph = makeGraph([hub]);

    expect(isAccessible(graph, '/ws/secret', '/ws/secret')).toBe(true);
  });

  it('returns false for nonexistent target', () => {
    const a = makeSpoke({ id: '/ws/a', name: 'a' });
    const hub: Hub = {
      id: '/ws',
      path: '/ws',
      name: 'ws',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [a],
      externals: [],
    };
    const graph = makeGraph([hub]);

    expect(isAccessible(graph, '/ws/a', '/ws/nonexistent')).toBe(false);
  });
});

describe('findSpoke', () => {
  const hub: Hub = {
    id: '/ws',
    path: '/ws',
    name: 'ws',
    constitution: {
      sourcePath: '',
      purpose: '',
      tree: [],
      entryPoints: [],
      dependencies: [],
      boundaries: [],
      principles: [],
      spokeDeclarations: [],
    },
    spokes: [
      makeSpoke({ id: '/ws/auth', name: 'auth' }),
      makeSpoke({ id: '/ws/api', name: 'api' }),
    ],
    externals: [],
  };
  const graph = makeGraph([hub]);

  it('finds by name', () => {
    expect(findSpoke(graph, 'auth')?.id).toBe('/ws/auth');
  });

  it('finds by id', () => {
    expect(findSpoke(graph, '/ws/api')?.name).toBe('api');
  });

  it('returns null for missing', () => {
    expect(findSpoke(graph, 'nonexistent')).toBeNull();
  });
});

describe('getExternals', () => {
  it('collects externals from all hubs', () => {
    const hub1: Hub = {
      id: '/ws1',
      path: '/ws1',
      name: 'ws1',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [],
      externals: [{ path: '~/projects/foo' }],
    };
    const hub2: Hub = {
      id: '/ws2',
      path: '/ws2',
      name: 'ws2',
      constitution: {
        sourcePath: '',
        purpose: '',
        tree: [],
        entryPoints: [],
        dependencies: [],
        boundaries: [],
        principles: [],
        spokeDeclarations: [],
      },
      spokes: [],
      externals: [{ path: '~/projects/bar' }],
    };
    const graph = makeGraph([hub1, hub2]);

    expect(getExternals(graph)).toHaveLength(2);
  });
});

// ── Query on fixture graph ───────────────────────────────────────

describe('queries on fixture graph', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-query-real-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('finds spokes by name in a built graph', async () => {
    const root = path.join(tmpDir, 'workspace');
    await fs.mkdir(path.join(root, 'auth'), { recursive: true });
    await fs.mkdir(path.join(root, 'api'), { recursive: true });

    await fs.writeFile(
      path.join(root, 'CONSTITUTION.md'),
      `# Workspace\n\n## Purpose\n\nTest workspace.\n\n## Spoke Charters\n\n| Sub-Repo | Audience | Governance | Purpose |\n|----------|----------|------------|--------|\n| \`auth/\` | Engineers | Own | Auth |\n| \`api/\` | Engineers | Shared | API |\n`,
    );
    await fs.writeFile(
      path.join(root, 'auth', 'CONSTITUTION.md'),
      '# Auth\n\n## Purpose\n\nAuth service.\n',
    );

    const graph = await buildGraph([root]);

    const auth = findSpoke(graph, 'auth');
    expect(auth).not.toBeNull();
    expect(auth!.name).toBe('auth');

    const api = findSpoke(graph, 'api');
    expect(api).not.toBeNull();
    expect(api!.name).toBe('api');

    expect(findSpoke(graph, 'nonexistent')).toBeNull();
  });
});
