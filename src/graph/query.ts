import * as path from 'node:path';
import type { HubGraph, Spoke, ExternalRef, ResolvedPath } from './types.js';
import { pathExists } from './utils.js';

/**
 * Resolve a reference from a spoke against the graph topology.
 *
 * Resolution order:
 * 1. Child of current spoke (spokePath/ref)
 * 2. Sibling spoke in the same hub (hubRoot/ref)
 * 3. Hub root itself (hubRoot/ref when ref matches a root-level path)
 * 4. External reference (if ref matches an external)
 *
 * Returns null if the reference can't be resolved.
 */
export async function resolveReference(
  graph: HubGraph,
  fromSpokeId: string,
  ref: string,
): Promise<ResolvedPath | null> {
  // Find the spoke and its parent hub
  const { spoke, hub } = findSpokeAndHub(graph, fromSpokeId);
  if (!hub) return null;

  const cleanRef = ref.replace(/\/$/, '');

  // 1. Child of current spoke
  if (spoke) {
    const childPath = path.join(spoke.path, cleanRef);
    if (await pathExists(childPath)) {
      return { absolutePath: childPath, resolvedIn: spoke.id, resolution: 'child' };
    }
  }

  // 2. Sibling spoke or hub root path
  const hubPath = path.join(hub.path, cleanRef);
  if (await pathExists(hubPath)) {
    // Check if it resolves to a sibling spoke
    const sibling = hub.spokes.find((s) => s.name === cleanRef || s.relativePath === cleanRef);
    if (sibling) {
      return { absolutePath: hubPath, resolvedIn: sibling.id, resolution: 'sibling' };
    }
    return { absolutePath: hubPath, resolvedIn: hub.id, resolution: 'hub_root' };
  }

  // 3. External reference
  for (const ext of hub.externals) {
    const resolvedExt = ext.path.startsWith('~')
      ? path.join(process.env.HOME || '', ext.path.slice(1))
      : ext.path;
    if (cleanRef === path.basename(resolvedExt) || cleanRef === ext.path) {
      if (await pathExists(resolvedExt)) {
        return { absolutePath: resolvedExt, resolvedIn: ext.path, resolution: 'external' };
      }
    }
  }

  return null;
}

/**
 * Traverse dependency edges from a spoke, returning all transitive dependencies.
 * Detects cycles and stops traversal when a cycle is found.
 */
export function traverseDependencies(
  graph: HubGraph,
  spokeId: string,
): { spokes: Spoke[]; hasCycle: boolean; cyclePath: string[] } {
  const visited = new Set<string>();
  const result: Spoke[] = [];
  const cyclePath: string[] = [];
  let hasCycle = false;

  function visit(currentId: string, path: string[]) {
    if (visited.has(currentId)) {
      if (path.includes(currentId)) {
        hasCycle = true;
        cyclePath.push(...path, currentId);
      }
      return;
    }
    visited.add(currentId);

    // Find dependency edges from this node
    const deps = graph.edges.filter((e) => e.from === currentId && e.kind === 'depends_on');

    for (const dep of deps) {
      // Try to find the target as a spoke
      const targetSpoke = findSpokeById(graph, dep.to);
      if (targetSpoke) {
        result.push(targetSpoke);
        visit(dep.to, [...path, currentId]);
      }
    }
  }

  visit(spokeId, []);
  return { spokes: result, hasCycle, cyclePath };
}

/**
 * Check if one spoke can access another, respecting boundary constraints.
 */
export function isAccessible(graph: HubGraph, fromSpokeId: string, toSpokeId: string): boolean {
  const targetSpoke = findSpokeById(graph, toSpokeId);
  if (!targetSpoke) return false;

  // Hard confidentiality = no external access
  if (targetSpoke.confidentiality === 'hard') {
    // Only accessible from itself or its children
    return toSpokeId === fromSpokeId || fromSpokeId.startsWith(toSpokeId + '/');
  }

  // Check boundary exclusions from the target's constitution
  if (targetSpoke.constitution) {
    for (const boundary of targetSpoke.constitution.boundaries) {
      if (boundary.level === 'hard') {
        // Find the source spoke name
        const fromSpoke = findSpokeById(graph, fromSpokeId);
        if (
          fromSpoke &&
          boundary.excludedFrom.some((ex) => fromSpoke.name.includes(ex.replace(/\/$/, '')))
        ) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Find a spoke by name or id across all hubs.
 */
export function findSpoke(graph: HubGraph, nameOrId: string): Spoke | null {
  return findSpokeById(graph, nameOrId) || findSpokeByName(graph, nameOrId);
}

/**
 * Get all unresolved external references across all hubs.
 */
export function getExternals(graph: HubGraph): ExternalRef[] {
  return graph.hubs.flatMap((h) => h.externals);
}

// ── Internal helpers ─────────────────────────────────────────────

function findSpokeById(graph: HubGraph, id: string): Spoke | null {
  for (const hub of graph.hubs) {
    for (const spoke of hub.spokes) {
      if (spoke.id === id) return spoke;
      for (const child of spoke.children) {
        if (child.id === id) return child;
      }
    }
  }
  return null;
}

function findSpokeByName(graph: HubGraph, name: string): Spoke | null {
  const cleanName = name.replace(/\/$/, '');
  for (const hub of graph.hubs) {
    for (const spoke of hub.spokes) {
      if (spoke.name === cleanName) return spoke;
    }
  }
  return null;
}

function findSpokeAndHub(graph: HubGraph, spokeId: string) {
  for (const hub of graph.hubs) {
    for (const spoke of hub.spokes) {
      if (spoke.id === spokeId) return { spoke, hub };
      for (const child of spoke.children) {
        if (child.id === spokeId) return { spoke: child, hub };
      }
    }
    // Maybe it's the hub itself
    if (hub.id === spokeId) return { spoke: null, hub };
  }
  return { spoke: null, hub: null };
}
