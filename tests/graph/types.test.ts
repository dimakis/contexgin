import { describe, it, expect } from 'vitest';
import type {
  Hub,
  Spoke,
  Constitution,
  Dependency,
  Boundary,
  EntryPoint,
  Violation,
  HubGraph,
  DeclaredNode,
  ExternalRef,
  ResolvedPath,
  ViolationKind,
} from '../../src/graph/types.js';
import { VIOLATION_KINDS } from '../../src/graph/types.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeConstitution(overrides?: Partial<Constitution>): Constitution {
  return {
    sourcePath: '/workspace/CONSTITUTION.md',
    purpose: 'Test workspace',
    tree: [],
    entryPoints: [],
    dependencies: [],
    boundaries: [],
    principles: [],
    spokeDeclarations: [],
    ...overrides,
  };
}

function makeHub(overrides?: Partial<Hub>): Hub {
  return {
    id: '/workspace',
    path: '/workspace',
    name: 'workspace',
    constitution: makeConstitution(),
    spokes: [],
    externals: [],
    ...overrides,
  };
}

function makeSpoke(overrides?: Partial<Spoke>): Spoke {
  return {
    id: '/workspace/auth',
    name: 'auth',
    path: '/workspace/auth',
    relativePath: 'auth',
    parentId: '/workspace',
    constitution: makeConstitution({ sourcePath: '/workspace/auth/CONSTITUTION.md' }),
    children: [],
    confidentiality: 'none',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Graph Primitives', () => {
  describe('Hub', () => {
    it('constructs with required fields', () => {
      const hub = makeHub();
      expect(hub.id).toBe('/workspace');
      expect(hub.name).toBe('workspace');
      expect(hub.spokes).toEqual([]);
      expect(hub.externals).toEqual([]);
    });

    it('holds spokes and externals', () => {
      const spoke = makeSpoke();
      const ext: ExternalRef = { path: '~/projects/other', description: 'sibling' };
      const hub = makeHub({ spokes: [spoke], externals: [ext] });

      expect(hub.spokes).toHaveLength(1);
      expect(hub.spokes[0].name).toBe('auth');
      expect(hub.externals).toHaveLength(1);
      expect(hub.externals[0].path).toBe('~/projects/other');
    });
  });

  describe('Spoke', () => {
    it('constructs with required fields', () => {
      const spoke = makeSpoke();
      expect(spoke.name).toBe('auth');
      expect(spoke.parentId).toBe('/workspace');
      expect(spoke.confidentiality).toBe('none');
      expect(spoke.children).toEqual([]);
    });

    it('supports null constitution for missing files', () => {
      const spoke = makeSpoke({ constitution: null });
      expect(spoke.constitution).toBeNull();
    });

    it('supports nested children', () => {
      const child = makeSpoke({
        id: '/workspace/auth/oauth',
        name: 'oauth',
        path: '/workspace/auth/oauth',
        relativePath: 'auth/oauth',
        parentId: '/workspace/auth',
      });
      const spoke = makeSpoke({ children: [child] });
      expect(spoke.children).toHaveLength(1);
      expect(spoke.children[0].name).toBe('oauth');
    });

    it('supports all confidentiality levels', () => {
      expect(makeSpoke({ confidentiality: 'none' }).confidentiality).toBe('none');
      expect(makeSpoke({ confidentiality: 'soft' }).confidentiality).toBe('soft');
      expect(makeSpoke({ confidentiality: 'hard' }).confidentiality).toBe('hard');
    });
  });

  describe('Constitution', () => {
    it('constructs with all fields populated', () => {
      const node: DeclaredNode = {
        path: 'src/',
        name: 'src',
        type: 'directory',
        description: 'Source code',
      };
      const ep: EntryPoint = {
        name: 'build',
        command: 'npm run build',
        description: 'Build the project',
        sourceId: '/workspace',
      };
      const dep: Dependency = {
        from: '/workspace/auth',
        to: '/workspace/db',
        kind: 'depends_on',
      };
      const boundary: Boundary = {
        spokeId: '/workspace/secrets',
        level: 'hard',
        description: 'No external access',
        excludedFrom: ['agents'],
      };

      const constitution = makeConstitution({
        tree: [node],
        entryPoints: [ep],
        dependencies: [dep],
        boundaries: [boundary],
        principles: ['No direct DB access from API layer'],
        spokeDeclarations: [{ name: 'auth', purpose: 'Authentication', confidentiality: 'none' }],
      });

      expect(constitution.tree).toHaveLength(1);
      expect(constitution.entryPoints).toHaveLength(1);
      expect(constitution.dependencies).toHaveLength(1);
      expect(constitution.boundaries).toHaveLength(1);
      expect(constitution.principles).toHaveLength(1);
      expect(constitution.spokeDeclarations).toHaveLength(1);
    });
  });

  describe('Dependency', () => {
    it('supports all dependency kinds', () => {
      const kinds: Dependency['kind'][] = [
        'contains',
        'depends_on',
        'external',
        'produces_for',
        'reads_from',
        'governed_by',
      ];

      for (const kind of kinds) {
        const dep: Dependency = { from: 'a', to: 'b', kind };
        expect(dep.kind).toBe(kind);
      }
    });

    it('carries optional description', () => {
      const dep: Dependency = {
        from: 'a',
        to: 'b',
        kind: 'depends_on',
        description: 'needs auth tokens',
      };
      expect(dep.description).toBe('needs auth tokens');
    });
  });

  describe('Violation', () => {
    it('constructs with all fields', () => {
      const v: Violation = {
        kind: 'missing_directory',
        severity: 'error',
        location: 'workspace/auth/migrations/',
        declared: 'auth/migrations/',
        actual: '(not found)',
        source: '/workspace/auth/CONSTITUTION.md',
        message: 'Declared directory auth/migrations/ does not exist',
        suggestion: 'Create the directory or remove it from the constitution',
      };

      expect(v.kind).toBe('missing_directory');
      expect(v.severity).toBe('error');
      expect(v.suggestion).toBeDefined();
    });

    it('works without suggestion', () => {
      const v: Violation = {
        kind: 'undeclared_directory',
        severity: 'warning',
        location: 'workspace/tmp/',
        declared: '(not declared)',
        actual: 'tmp/',
        source: '/workspace/CONSTITUTION.md',
        message: 'Directory tmp/ exists but is not declared in any constitution',
      };

      expect(v.suggestion).toBeUndefined();
    });
  });

  describe('VIOLATION_KINDS', () => {
    it('contains all violation kinds', () => {
      expect(VIOLATION_KINDS).toHaveLength(9);
    });

    it('is exhaustive (every kind is assignable to ViolationKind)', () => {
      // This is a compile-time check — if a kind is missing from the array,
      // TypeScript won't catch it at runtime, but we verify the count matches
      const expected: ViolationKind[] = [
        'missing_directory',
        'missing_file',
        'undeclared_directory',
        'missing_constitution',
        'stale_reference',
        'broken_dependency',
        'missing_external',
        'boundary_violation',
        'nesting_depth',
      ];
      expect(VIOLATION_KINDS).toEqual(expected);
    });
  });

  describe('HubGraph', () => {
    it('composes hubs, edges, and violations', () => {
      const hub = makeHub({ spokes: [makeSpoke()] });
      const edge: Dependency = {
        from: '/workspace',
        to: '/workspace/auth',
        kind: 'contains',
      };
      const graph: HubGraph = {
        hubs: [hub],
        edges: [edge],
        violations: [],
      };

      expect(graph.hubs).toHaveLength(1);
      expect(graph.edges).toHaveLength(1);
      expect(graph.violations).toHaveLength(0);
    });
  });

  describe('ResolvedPath', () => {
    it('captures resolution strategy', () => {
      const resolved: ResolvedPath = {
        absolutePath: '/workspace/auth/src/handler.ts',
        resolvedIn: '/workspace/auth',
        resolution: 'child',
      };
      expect(resolved.resolution).toBe('child');
    });

    it('supports all resolution types', () => {
      const types: ResolvedPath['resolution'][] = ['child', 'sibling', 'hub_root', 'external'];
      for (const t of types) {
        const r: ResolvedPath = { absolutePath: '/a', resolvedIn: '/b', resolution: t };
        expect(r.resolution).toBe(t);
      }
    });
  });

  describe('JSON roundtrip', () => {
    it('serializes and deserializes Hub', () => {
      const hub = makeHub({ spokes: [makeSpoke()] });
      const json = JSON.stringify(hub);
      const parsed = JSON.parse(json) as Hub;

      expect(parsed.id).toBe(hub.id);
      expect(parsed.name).toBe(hub.name);
      expect(parsed.spokes).toHaveLength(1);
      expect(parsed.spokes[0].name).toBe('auth');
    });

    it('serializes and deserializes Violation', () => {
      const v: Violation = {
        kind: 'broken_dependency',
        severity: 'error',
        location: 'auth → nonexistent',
        declared: 'nonexistent',
        actual: '(not found)',
        source: '/workspace/auth/CONSTITUTION.md',
        message: 'Dependency target does not exist',
      };
      const parsed = JSON.parse(JSON.stringify(v)) as Violation;
      expect(parsed.kind).toBe('broken_dependency');
      expect(parsed.message).toBe(v.message);
    });

    it('serializes and deserializes HubGraph', () => {
      const graph: HubGraph = {
        hubs: [makeHub()],
        edges: [{ from: 'a', to: 'b', kind: 'depends_on' }],
        violations: [
          {
            kind: 'missing_file',
            severity: 'error',
            location: 'test',
            declared: 'x',
            actual: 'y',
            source: 'z',
            message: 'gone',
          },
        ],
      };
      const parsed = JSON.parse(JSON.stringify(graph)) as HubGraph;
      expect(parsed.hubs).toHaveLength(1);
      expect(parsed.edges).toHaveLength(1);
      expect(parsed.violations).toHaveLength(1);
    });
  });
});
