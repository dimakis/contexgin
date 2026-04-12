import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Claim, DriftReport } from './types.js';
import { extractClaims, extractTreeStructureClaim } from './claims.js';
import { validateAll } from './validator.js';

/** A federated drift report covering a hub and its external repos */
export interface FederatedDriftReport {
  /** Drift report for the primary workspace */
  root: DriftReport;
  /** Drift reports for external repos (path → report) */
  externals: Map<string, DriftReport>;
}

export interface FederatedOptions {
  /** Whether to validate external repos' own tree structures (default: false) */
  cascade: boolean;
}

/**
 * Run integrity validation across one or more workspace roots,
 * optionally cascading into external repos declared in constitutions.
 *
 * Reads each root's CONSTITUTION.md, extracts all claims (including
 * tree structure and external references), validates them, and
 * optionally recurses into external repos.
 */
export async function validateFederated(
  roots: string[],
  options?: Partial<FederatedOptions>,
): Promise<FederatedDriftReport> {
  const cascade = options?.cascade ?? false;
  const perRootReports: DriftReport[] = [];
  const externalEntries: Array<{ target: string; declaringRoot: string }> = [];

  for (const root of roots) {
    const constPath = path.join(root, 'CONSTITUTION.md');
    let content: string;
    try {
      content = await fs.readFile(constPath, 'utf-8');
    } catch {
      continue;
    }

    // Extract claims for this root
    const claims: Claim[] = extractClaims(content, constPath);
    const { treeClaim, externalClaims } = extractTreeStructureClaim(content, constPath);
    if (treeClaim) claims.push(treeClaim);
    claims.push(...externalClaims);

    // Validate against this root's own workspace
    const report = await validateAll(claims, root);
    perRootReports.push(report);

    // Collect external paths with their declaring root for cascade
    for (const ext of externalClaims) {
      externalEntries.push({ target: ext.target, declaringRoot: root });
    }
  }

  // Merge all per-root reports into a single root report
  const workspaceRoot = roots[0] || '.';
  const allResults = perRootReports.flatMap((r) => r.results);
  const allDrift = perRootReports.flatMap((r) => r.drift);
  const rootReport: DriftReport = {
    timestamp: new Date(),
    workspaceRoot,
    results: allResults,
    drift: allDrift,
    summary: {
      total: allResults.length,
      valid: allResults.filter((r) => r.valid).length,
      invalid: allDrift.length,
      byKind: allResults.reduce(
        (acc, r) => {
          const kind = r.claim.kind;
          if (!acc[kind]) acc[kind] = { total: 0, invalid: 0 };
          acc[kind].total++;
          if (!r.valid) acc[kind].invalid++;
          return acc;
        },
        {} as Record<string, { total: number; invalid: number }>,
      ),
    },
  };

  // Cascade into external repos if enabled
  const externals = new Map<string, DriftReport>();
  if (cascade) {
    for (const { target: extPath, declaringRoot } of externalEntries) {
      const resolvedPath = extPath.startsWith('~')
        ? path.join(process.env.HOME || '', extPath.slice(1))
        : path.resolve(declaringRoot, extPath);

      try {
        const extConstPath = path.join(resolvedPath, 'CONSTITUTION.md');
        const extContent = await fs.readFile(extConstPath, 'utf-8');

        const extClaims: Claim[] = extractClaims(extContent, extConstPath);
        const { treeClaim } = extractTreeStructureClaim(extContent, extConstPath);
        if (treeClaim) extClaims.push(treeClaim);

        const extReport = await validateAll(extClaims, resolvedPath);
        externals.set(extPath, extReport);
      } catch {
        // External repo doesn't exist or has no constitution — already caught by external_exists claim
      }
    }
  }

  return { root: rootReport, externals };
}
