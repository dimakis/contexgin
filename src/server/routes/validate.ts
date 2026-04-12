import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildGraph } from '../../graph/builder.js';
import { validateGraph } from '../../graph/validate.js';
import type { ServerConfig, ValidateRequest, ValidateResponse } from '../types.js';

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
    const allViolations = [...graph.violations, ...violations];

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
