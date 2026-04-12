import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Hub, Spoke, Dependency, HubGraph, ExternalRef, Violation } from './types.js';
import { parseConstitution } from './parser.js';
import { loadIgnorePatterns } from './ignore.js';

/**
 * Build a structural graph from one or more hub roots.
 *
 * For each root:
 * 1. Load .centaurignore
 * 2. Parse root CONSTITUTION.md
 * 3. Discover spokes from spoke declarations
 * 4. Parse each spoke's CONSTITUTION.md
 * 5. Build dependency edges
 * 6. Collect violations
 */
export async function buildGraph(roots: string[]): Promise<HubGraph> {
  const hubs: Hub[] = [];
  const allEdges: Dependency[] = [];
  const allViolations: Violation[] = [];

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    const hubId = resolvedRoot;
    const hubName = path.basename(resolvedRoot);

    // Load ignore patterns
    const ignorePatterns = await loadIgnorePatterns(resolvedRoot);

    // Parse root constitution
    const constPath = path.join(resolvedRoot, 'CONSTITUTION.md');
    let constitution;
    try {
      constitution = await parseConstitution(constPath, hubId);
    } catch {
      // No constitution at root — record violation and create minimal hub
      allViolations.push({
        kind: 'missing_constitution',
        severity: 'error',
        location: resolvedRoot,
        declared: 'CONSTITUTION.md',
        actual: '(not found)',
        source: resolvedRoot,
        message: `Hub root ${hubName}/ has no CONSTITUTION.md`,
        suggestion: 'Create a CONSTITUTION.md at the hub root',
      });
      continue;
    }

    // Build spokes from declarations
    const spokes: Spoke[] = [];
    const externals: ExternalRef[] = [];

    for (const decl of constitution.spokeDeclarations) {
      const spokePath = path.join(resolvedRoot, decl.name);
      const spokeId = `${hubId}/${decl.name}`;

      // Check spoke directory exists
      let spokeExists = false;
      try {
        const stat = await fs.stat(spokePath);
        spokeExists = stat.isDirectory();
      } catch {
        // Directory doesn't exist
      }

      if (!spokeExists) {
        allViolations.push({
          kind: 'missing_directory',
          severity: 'error',
          location: spokeId,
          declared: `${decl.name}/`,
          actual: '(not found)',
          source: constPath,
          message: `Declared spoke ${decl.name}/ does not exist`,
          suggestion: `Create directory ${decl.name}/ or remove it from spoke charters`,
        });
        continue;
      }

      // Parse spoke constitution
      const spokeConstPath = path.join(spokePath, 'CONSTITUTION.md');
      let spokeConstitution = null;
      try {
        spokeConstitution = await parseConstitution(spokeConstPath, spokeId);
      } catch {
        allViolations.push({
          kind: 'missing_constitution',
          severity: 'warning',
          location: spokeId,
          declared: `${decl.name}/CONSTITUTION.md`,
          actual: '(not found)',
          source: constPath,
          message: `Spoke ${decl.name}/ has no CONSTITUTION.md`,
          suggestion: `Create ${decl.name}/CONSTITUTION.md`,
        });
      }

      const spoke: Spoke = {
        id: spokeId,
        name: decl.name,
        path: spokePath,
        relativePath: decl.name,
        parentId: hubId,
        constitution: spokeConstitution,
        children: [],
        confidentiality: decl.confidentiality,
        audience: decl.audience,
        governance: decl.governance,
      };

      spokes.push(spoke);

      // Create 'contains' edge
      allEdges.push({
        from: hubId,
        to: spokeId,
        kind: 'contains',
      });

      // Add spoke dependencies as edges
      if (spokeConstitution) {
        for (const dep of spokeConstitution.dependencies) {
          allEdges.push({
            from: spokeId,
            to: dep.to,
            kind: dep.kind,
            description: dep.description,
          });
        }
      }
    }

    // Also discover spokes from filesystem that aren't in declarations
    // (these may be undeclared directories — violations handled in validate step)
    try {
      const dirEntries = await fs.readdir(resolvedRoot, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory()) continue;
        if (ignorePatterns.matcher.ignores(entry.name + '/')) continue;
        if (entry.name.startsWith('.')) continue;

        // Check if this spoke is already declared
        const alreadyDeclared = spokes.some((s) => s.name === entry.name);
        if (alreadyDeclared) continue;

        // Check if it has a CONSTITUTION.md (undeclared but constituted = potential spoke)
        const potentialConstPath = path.join(resolvedRoot, entry.name, 'CONSTITUTION.md');
        try {
          await fs.access(potentialConstPath);
          // Has a constitution but not declared — interesting but not an error at build time
          // The validation step will flag undeclared directories
        } catch {
          // No constitution — just an undeclared directory, skip during build
        }
      }
    } catch {
      // Can't read directory
    }

    // Collect external references from root constitution dependencies
    // and from any [external] references in parsed constitutions
    for (const dep of constitution.dependencies) {
      if (dep.kind === 'external') {
        externals.push({ path: dep.to, description: dep.description });
      }
    }

    // Add root-level dependency edges
    for (const dep of constitution.dependencies) {
      allEdges.push({
        from: hubId,
        to: dep.to,
        kind: dep.kind,
        description: dep.description,
      });
    }

    const hub: Hub = {
      id: hubId,
      path: resolvedRoot,
      name: hubName,
      constitution,
      spokes,
      externals,
    };

    hubs.push(hub);
  }

  return {
    hubs,
    edges: allEdges,
    violations: allViolations,
  };
}
