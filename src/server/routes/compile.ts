import type { FastifyInstance } from 'fastify';
import { compileWithAdapters } from '../../compiler/index.js';
import { findSpoke } from '../../graph/query.js';
import type { ServerState, CompileRequest, CompileResponse } from '../types.js';

export function compileRoute(app: FastifyInstance, state: ServerState): void {
  app.post<{ Body: CompileRequest }>('/compile', async (request, reply) => {
    if (!state.graph) {
      return reply.status(503).send({ error: 'Graph not built yet' });
    }

    const { spoke: spokeQuery, task, budget = 8000 } = request.body;
    if (!spokeQuery) {
      return reply.status(400).send({ error: 'Missing required field: spoke' });
    }

    // Find the spoke in the graph
    const spoke = findSpoke(state.graph, spokeQuery);
    if (!spoke) {
      return reply.status(404).send({ error: `Spoke not found: ${spokeQuery}` });
    }

    // Compile context using adapter pipeline
    const compiled = await compileWithAdapters({
      workspaceRoot: spoke.path,
      tokenBudget: budget,
      taskHint: task,
    });

    const response: CompileResponse = {
      context: compiled.bootPayload,
      tokens: compiled.bootTokens,
      sources: compiled.sources.length,
      spoke: spoke.id,
      nodes: compiled.nodes,
    };

    return response;
  });
}
