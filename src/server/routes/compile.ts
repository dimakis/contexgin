import type { FastifyInstance } from 'fastify';
import { compile, compileWithAdapters } from '../../compiler/index.js';
import { findSpoke } from '../../graph/query.js';
import { DEFAULT_COMPILE_BUDGET } from '../types.js';
import type { ServerState, CompileRequest, CompileResponse } from '../types.js';

export function compileRoute(app: FastifyInstance, state: ServerState): void {
  app.post<{ Body: CompileRequest }>('/compile', async (request, reply) => {
    if (!state.graph) {
      return reply.status(503).send({ error: 'Graph not built yet' });
    }

    const { spoke: spokeQuery, task, budget = DEFAULT_COMPILE_BUDGET, legacy = false } = request.body;
    if (!spokeQuery) {
      return reply.status(400).send({ error: 'Missing required field: spoke' });
    }

    // Find the spoke in the graph
    const spoke = findSpoke(state.graph, spokeQuery);
    if (!spoke) {
      return reply.status(404).send({ error: `Spoke not found: ${spokeQuery}` });
    }

    const compileOptions = {
      workspaceRoot: spoke.path,
      tokenBudget: budget,
      taskHint: task,
    };

    try {
      if (legacy) {
        // Legacy pipeline — flat text, no typed nodes
        const compiled = await compile(compileOptions);
        const response: CompileResponse = {
          context: compiled.bootPayload,
          tokens: compiled.bootTokens,
          sources: compiled.sources.length,
          spoke: spoke.id,
        };
        return response;
      }

      // Adapter pipeline — typed context nodes
      const compiled = await compileWithAdapters(compileOptions);
      const response: CompileResponse = {
        context: compiled.bootPayload,
        tokens: compiled.bootTokens,
        sources: compiled.sources.length,
        spoke: spoke.id,
        nodes: compiled.nodes,
      };
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err, spoke: spokeQuery }, 'Compilation failed');
      return reply.status(500).send({ error: `Compilation failed: ${message}` });
    }
  });
}
