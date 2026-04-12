import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildGraph } from '../../graph/builder.js';
import { validateGraph } from '../../graph/validate.js';
import { extractDocContracts, extractDocClaims } from '../../integrity/doc-claims.js';
import { validateDocClaims } from '../../integrity/doc-validator.js';
import type { Violation } from '../../graph/types.js';
import type { ServerConfig, ValidateRequest, ValidateResponse } from '../types.js';

/**
 * Run doc-consistency validation for a single hub root.
 * Reads CONSTITUTION.md, extracts contracts, validates claims.
 */
async function runDocConsistencyValidation(hubRoot: string): Promise<Violation[]> {
  const constitutionPath = path.join(hubRoot, 'CONSTITUTION.md');
  let content: string;
  try {
    content = await fs.readFile(constitutionPath, 'utf-8');
  } catch {
    return []; // No CONSTITUTION.md — skip
  }

  const contracts = extractDocContracts(content);
  if (contracts.length === 0) return [];

  const claims = await extractDocClaims(contracts, hubRoot);
  if (claims.length === 0) return [];

  const results = await validateDocClaims(claims, hubRoot);
  const violations: Violation[] = [];

  for (const result of results) {
    if (!result.valid) {
      violations.push({
        kind: 'stale_reference',
        severity: 'warning',
        location: result.claim.source,
        declared: result.claim.assertion,
        actual: result.actual ?? '(mismatch)',
        source: constitutionPath,
        message: result.message,
        suggestion: `Update the documentation to match reality or fix the code to match the docs`,
      });
    }
  }

  return violations;
}

export function validateRoute(app: FastifyInstance, config: ServerConfig): void {
  app.post<{ Body: ValidateRequest }>('/validate', async (request, reply) => {
    const rawRoots = request.body?.roots ?? config.roots;
    if (rawRoots.length === 0) {
      return reply.status(400).send({ error: 'No roots configured or provided' });
    }

    const roots = rawRoots.map((r) => path.resolve(r.replace(/^~/, process.env.HOME || '')));

    // Build fresh graph and validate (does not mutate server state)
    const graph = await buildGraph(roots);
    const violations = await validateGraph(graph);

    // Run doc-consistency validation for each root
    const docViolations = await Promise.all(roots.map(runDocConsistencyValidation));
    const allDocViolations = docViolations.flat();

    const allViolations = [...graph.violations, ...violations, ...allDocViolations];

    const response: ValidateResponse = {
      violations: allViolations,
      summary: {
        errors: allViolations.filter((v) => v.severity === 'error').length,
        warnings: allViolations.filter((v) => v.severity === 'warning').length,
        info: allViolations.filter((v) => v.severity === 'info').length,
        hubs: graph.hubs.length,
        spokes: graph.hubs.reduce((n, h) => n + h.spokes.length, 0),
      },
    };

    return response;
  });
}
