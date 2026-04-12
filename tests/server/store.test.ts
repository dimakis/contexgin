import { describe, it, expect, afterEach } from 'vitest';
import { GraphStore } from '../../src/server/store.js';
import type { HubGraph } from '../../src/graph/types.js';

function makeGraph(hubCount = 1): HubGraph {
  const hubs = Array.from({ length: hubCount }, (_, i) => ({
    id: `hub-${i}`,
    path: `/tmp/hub-${i}`,
    name: `hub-${i}`,
    constitution: {
      sourcePath: `/tmp/hub-${i}/CONSTITUTION.md`,
      purpose: `Hub ${i}`,
      tree: [],
      entryPoints: [],
      dependencies: [],
      boundaries: [],
      principles: [],
      spokeDeclarations: [],
    },
    spokes: [
      {
        id: `hub-${i}/spoke-a`,
        name: 'spoke-a',
        path: `/tmp/hub-${i}/spoke-a`,
        relativePath: 'spoke-a',
        parentId: `hub-${i}`,
        constitution: null,
        children: [],
        confidentiality: 'none' as const,
      },
    ],
    externals: [],
  }));

  return {
    hubs,
    edges: [],
    violations: [],
  };
}

describe('GraphStore', () => {
  let store: GraphStore;

  afterEach(() => {
    if (store) store.close();
  });

  it('creates tables on initialization', () => {
    store = new GraphStore(':memory:');
    // No throw = success
  });

  it('saves and retrieves a snapshot', () => {
    store = new GraphStore(':memory:');
    const graph = makeGraph();

    const id = store.saveSnapshot(graph);
    expect(id).toBe(1);

    const snapshot = store.getLatestSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.hubs).toBe(1);
    expect(snapshot!.spokes).toBe(1);
    expect(snapshot!.graph.hubs[0].name).toBe('hub-0');
  });

  it('returns null when no snapshots exist', () => {
    store = new GraphStore(':memory:');
    expect(store.getLatestSnapshot()).toBeNull();
  });

  it('returns latest snapshot when multiple exist', () => {
    store = new GraphStore(':memory:');

    store.saveSnapshot(makeGraph(1));
    store.saveSnapshot(makeGraph(2));

    const latest = store.getLatestSnapshot();
    expect(latest!.hubs).toBe(2);
  });

  it('records and retrieves build history', () => {
    store = new GraphStore(':memory:');

    store.recordBuild(150, 'initial', true);
    store.recordBuild(80, 'watch', true);
    store.recordBuild(200, 'watch', false, 'File not found');

    const builds = store.getBuilds();
    expect(builds).toHaveLength(3);
    // Most recent first
    expect(builds[0].success).toBe(false);
    expect(builds[0].error).toBe('File not found');
    expect(builds[1].duration_ms).toBe(80);
    expect(builds[2].success).toBe(true);
  });

  it('respects build history limit', () => {
    store = new GraphStore(':memory:');

    for (let i = 0; i < 30; i++) {
      store.recordBuild(100, 'watch', true);
    }

    const builds = store.getBuilds(5);
    expect(builds).toHaveLength(5);
  });
});
