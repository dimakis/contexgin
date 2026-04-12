import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HubGraph, Violation } from './types.js';
import { loadIgnorePatterns, shouldIgnore } from './ignore.js';
import { pathExists } from './utils.js';

/**
 * Validate a built graph against the filesystem.
 *
 * Level 1 — Structural: declared paths exist, undeclared paths flagged
 * Level 2 — Relational: dependencies resolve, externals exist, entry points callable
 */
export async function validateGraph(graph: HubGraph): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const hub of graph.hubs) {
    const ignorePatterns = await loadIgnorePatterns(hub.path);

    // Level 1: Structural — hub root declared tree
    for (const node of hub.constitution.tree) {
      const fullPath = path.join(hub.path, node.path);
      const exists = await pathExists(fullPath);
      if (!exists) {
        const kind = node.type === 'directory' ? 'missing_directory' : 'missing_file';
        violations.push({
          kind,
          severity: 'error',
          location: `${hub.name}/${node.path}`,
          declared: node.path,
          actual: '(not found)',
          source: hub.constitution.sourcePath,
          message: `Declared ${node.type} ${node.path} does not exist`,
          suggestion: `Create ${node.path} or remove it from the constitution`,
        });
      }
    }

    // Level 1: Structural — spoke declared trees
    for (const spoke of hub.spokes) {
      if (!spoke.constitution) continue;

      for (const node of spoke.constitution.tree) {
        const fullPath = path.join(spoke.path, node.path);
        const exists = await pathExists(fullPath);
        if (!exists) {
          const kind = node.type === 'directory' ? 'missing_directory' : 'missing_file';
          violations.push({
            kind,
            severity: 'warning',
            location: `${hub.name}/${spoke.name}/${node.path}`,
            declared: node.path,
            actual: '(not found)',
            source: spoke.constitution.sourcePath,
            message: `Declared ${node.type} ${node.path} does not exist in spoke ${spoke.name}`,
            suggestion: `Create ${spoke.name}/${node.path} or update the constitution`,
          });
        }
      }
    }

    // Level 1: Undeclared directories in hub root
    const declaredNames = new Set<string>();
    for (const spoke of hub.spokes) {
      declaredNames.add(spoke.name);
    }
    for (const node of hub.constitution.tree) {
      declaredNames.add(node.path.replace(/\/$/, '').split('/')[0]);
    }
    // Also add spoke declaration names (some may not have become spokes due to missing dirs)
    for (const decl of hub.constitution.spokeDeclarations) {
      declaredNames.add(decl.name);
    }

    try {
      const entries = await fs.readdir(hub.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (shouldIgnore(entry.name + '/', ignorePatterns)) continue;
        if (declaredNames.has(entry.name)) continue;

        violations.push({
          kind: 'undeclared_directory',
          severity: 'info',
          location: `${hub.name}/${entry.name}/`,
          declared: '(not declared)',
          actual: `${entry.name}/`,
          source: hub.constitution.sourcePath,
          message: `Directory ${entry.name}/ exists but is not declared in the constitution or .centaurignore`,
          suggestion: `Add ${entry.name}/ to the constitution's spoke charters, directory semantics table, or .centaurignore`,
        });
      }
    } catch {
      // Can't read hub root
    }

    // Level 2: Entry points — hub and spoke constitutions
    const entryPointSources: Array<{
      ep: (typeof hub.constitution.entryPoints)[0];
      resolveRoot: string;
      locationPrefix: string;
      source: string;
    }> = [];

    // Hub entry points resolve relative to hub root
    for (const ep of hub.constitution.entryPoints) {
      entryPointSources.push({
        ep,
        resolveRoot: hub.path,
        locationPrefix: hub.name,
        source: hub.constitution.sourcePath,
      });
    }

    // Spoke entry points resolve relative to spoke root
    for (const spoke of hub.spokes) {
      if (!spoke.constitution) continue;
      for (const ep of spoke.constitution.entryPoints) {
        entryPointSources.push({
          ep,
          resolveRoot: spoke.path,
          locationPrefix: `${hub.name}/${spoke.name}`,
          source: spoke.constitution.sourcePath,
        });
      }
    }

    for (const { ep, resolveRoot, locationPrefix, source } of entryPointSources) {
      const baseCmd = ep.command.split(/\s+/)[0];
      // Skip HTTP endpoints like "GET /health", "POST /webhook"
      if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/i.test(ep.command)) continue;
      // Skip function-style exports like "compile()"
      if (baseCmd.endsWith(')')) continue;
      // Only validate explicit relative paths (./script, ../tool)
      // Skip system commands (npm, docker, node, python, etc.)
      if (!baseCmd.startsWith('./') && !baseCmd.startsWith('../')) continue;

      const cmdPath = path.join(resolveRoot, baseCmd);
      if (!(await pathExists(cmdPath))) {
        violations.push({
          kind: 'stale_reference',
          severity: 'warning',
          location: locationPrefix,
          declared: ep.command,
          actual: '(not found)',
          source,
          message: `Entry point ${ep.command} — base file ${baseCmd} not found`,
          suggestion: `Update entry point or create ${baseCmd}`,
        });
      }
    }

    // Level 2: External references
    for (const ext of hub.externals) {
      const resolvedPath = ext.path.startsWith('~')
        ? path.join(process.env.HOME || '', ext.path.slice(1))
        : path.resolve(ext.path);

      if (!(await pathExists(resolvedPath))) {
        violations.push({
          kind: 'missing_external',
          severity: 'warning',
          location: hub.name,
          declared: ext.path,
          actual: '(not found)',
          source: hub.constitution.sourcePath,
          message: `External reference ${ext.path} does not exist`,
          suggestion: `Update or remove the external reference`,
        });
      } else {
        // External exists — check for CONSTITUTION.md
        const extConst = path.join(resolvedPath, 'CONSTITUTION.md');
        if (!(await pathExists(extConst))) {
          violations.push({
            kind: 'missing_constitution',
            severity: 'info',
            location: ext.path,
            declared: `${ext.path}/CONSTITUTION.md`,
            actual: '(not found)',
            source: hub.constitution.sourcePath,
            message: `External ${ext.path} exists but has no CONSTITUTION.md`,
          });
        }
      }
    }

    // Level 2: Spoke dependencies resolve
    for (const spoke of hub.spokes) {
      if (!spoke.constitution) continue;

      for (const dep of spoke.constitution.dependencies) {
        // Try to resolve the dependency target within the graph
        const targetName = dep.to.replace(/\/$/, '').split(/\s/)[0];

        // Check if it's a known spoke
        const isKnownSpoke = hub.spokes.some((s) => s.name === targetName);

        // Check if it's a declared directory in the hub
        const isDeclaredDir = hub.constitution.tree.some(
          (n) => n.path.replace(/\/$/, '') === targetName,
        );

        // Check if it exists on disk at hub level
        const existsOnDisk = await pathExists(path.join(hub.path, targetName));

        if (!isKnownSpoke && !isDeclaredDir && !existsOnDisk) {
          violations.push({
            kind: 'broken_dependency',
            severity: 'warning',
            location: `${hub.name}/${spoke.name}`,
            declared: dep.to,
            actual: '(not found)',
            source: spoke.constitution.sourcePath,
            message: `Spoke ${spoke.name} depends on "${dep.to}" which cannot be resolved`,
            suggestion: `Verify the dependency target exists or update the Dependencies section`,
          });
        }
      }
    }
  }

  return violations;
}
