import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  Claim,
  ClaimResult,
  DriftReport,
  TreeStructureClaim,
  TreeClaimResult,
} from './types.js';
import { walkFilesystem } from './tree-walker.js';
import { diffTrees } from './tree-diff.js';

/**
 * Validate a single claim against the filesystem.
 */
export async function validateClaim(claim: Claim, workspaceRoot: string): Promise<ClaimResult> {
  const targetPath = path.resolve(workspaceRoot, claim.target.replace(/\/$/, ''));

  switch (claim.kind) {
    case 'file_exists': {
      try {
        const stat = await fs.stat(targetPath);
        if (stat.isFile()) {
          return { claim, valid: true, message: `File ${claim.target} exists` };
        }
        return {
          claim,
          valid: false,
          actual: 'directory',
          message: `${claim.target} exists but is a directory, not a file`,
        };
      } catch {
        return { claim, valid: false, message: `File ${claim.target} not found` };
      }
    }

    case 'directory_exists': {
      try {
        const stat = await fs.stat(targetPath);
        if (stat.isDirectory()) {
          return { claim, valid: true, message: `Directory ${claim.target} exists` };
        }
        return {
          claim,
          valid: false,
          actual: 'file',
          message: `${claim.target} exists but is a file, not a directory`,
        };
      } catch {
        return { claim, valid: false, message: `Directory ${claim.target} not found` };
      }
    }

    case 'entry_point': {
      try {
        await fs.stat(targetPath);
        return { claim, valid: true, message: `Entry point ${claim.target} exists` };
      } catch {
        return { claim, valid: false, message: `Entry point ${claim.target} not found` };
      }
    }

    case 'tree_structure': {
      const treeClaim = claim as TreeStructureClaim;
      const maxDepth = Math.max(
        2,
        ...treeClaim.declaredTree.map((n) => n.path.split('/').filter(Boolean).length),
      );
      const actual = await walkFilesystem(workspaceRoot, { maxDepth });
      const diff = diffTrees(treeClaim.declaredTree, actual);
      const valid = diff.declaredButMissing.length === 0;
      const message = valid
        ? `Tree structure: all ${diff.matched.length} declared paths found`
        : `Tree structure: ${diff.declaredButMissing.length} declared path(s) missing — ${diff.declaredButMissing.map((n) => n.path).join(', ')}`;
      return { claim, valid, diff, message } as TreeClaimResult;
    }

    case 'external_exists': {
      const resolvedPath = claim.target.startsWith('~')
        ? path.join(os.homedir(), claim.target.slice(1))
        : path.resolve(workspaceRoot, claim.target.replace(/\/$/, ''));
      try {
        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return {
            claim,
            valid: false,
            message: `External ${claim.target} exists but is not a directory`,
          };
        }
        // Also check for CONSTITUTION.md
        try {
          await fs.stat(path.join(resolvedPath, 'CONSTITUTION.md'));
          return {
            claim,
            valid: true,
            message: `External ${claim.target} exists with CONSTITUTION.md`,
          };
        } catch {
          return {
            claim,
            valid: true,
            message: `External ${claim.target} exists (no CONSTITUTION.md)`,
          };
        }
      } catch {
        return { claim, valid: false, message: `External ${claim.target} not found` };
      }
    }

    case 'boundary':
    case 'structural': {
      // Structural and boundary claims require more context to validate
      return {
        claim,
        valid: true,
        message: `${claim.kind} claim — skipped (requires manual review)`,
      };
    }

    default: {
      return { claim, valid: false, message: `Unknown claim kind: ${claim.kind}` };
    }
  }
}

/**
 * Validate all claims and produce a drift report.
 */
export async function validateAll(claims: Claim[], workspaceRoot: string): Promise<DriftReport> {
  const results: ClaimResult[] = await Promise.all(
    claims.map((claim) => validateClaim(claim, workspaceRoot)),
  );

  const drift = results.filter((r) => !r.valid);

  // Build summary by kind
  const byKind: Record<string, { total: number; invalid: number }> = {};
  for (const result of results) {
    const kind = result.claim.kind;
    if (!byKind[kind]) {
      byKind[kind] = { total: 0, invalid: 0 };
    }
    byKind[kind].total++;
    if (!result.valid) {
      byKind[kind].invalid++;
    }
  }

  return {
    timestamp: new Date(),
    workspaceRoot,
    results,
    drift,
    summary: {
      total: results.length,
      valid: results.length - drift.length,
      invalid: drift.length,
      byKind,
    },
  };
}
