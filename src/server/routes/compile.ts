import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
import { compile } from '../../compiler/index.js';
import { findSpoke } from '../../graph/query.js';
import { DEFAULT_COMPILE_BUDGET } from '../types.js';
import type { ServerConfig, ServerState, CompileRequest, CompileResponse } from '../types.js';

function resolveWorkspace(
  state: ServerState,
  config: ServerConfig,
  query: string,
): { id: string; path: string } | null {
  if (!state.graph) return null;

  const spoke = findSpoke(state.graph, query);
  if (spoke) return spoke;

  const expanded = query.replace(/^~(?=$|\/)/, process.env.HOME || '');
  const resolvedQuery = path.resolve(expanded);

  const hub = state.graph.hubs.find(
    (candidate) =>
      candidate.id === query ||
      candidate.name === query ||
      path.resolve(candidate.path) === resolvedQuery,
  );
  if (hub) return hub;

  // A configured root can be valid compiler input even when it has no
  // CONSTITUTION.md and therefore is intentionally absent from the graph.
  // Exact-path matching keeps /compile constrained to operator-approved roots.
  const configuredRoot = config.roots.find((root) => {
    const expandedRoot = root.replace(/^~(?=$|\/)/, process.env.HOME || '');
    return path.resolve(expandedRoot) === resolvedQuery;
  });
  if (configuredRoot) {
    const expandedRoot = configuredRoot.replace(/^~(?=$|\/)/, process.env.HOME || '');
    const rootPath = path.resolve(expandedRoot);
    return { id: rootPath, path: rootPath };
  }

  return null;
}

export function compileRoute(app: FastifyInstance, state: ServerState, config: ServerConfig): void {
  app.post<{ Body: CompileRequest }>('/compile', async (request, reply) => {
    if (!state.graph) {
      return reply.status(503).send({ error: 'Graph not built yet' });
    }

    const { spoke: spokeQuery, task, budget = DEFAULT_COMPILE_BUDGET } = request.body;
    if (!spokeQuery) {
      return reply.status(400).send({ error: 'Missing required field: spoke' });
    }

    const workspace = resolveWorkspace(state, config, spokeQuery);
    if (!workspace) {
      return reply.status(404).send({ error: `Workspace not found: ${spokeQuery}` });
    }

    try {
      const compiled = await compile({
        workspaceRoot: workspace.path,
        tokenBudget: budget,
        taskHint: task,
      });
      const response: CompileResponse = {
        context: compiled.bootPayload,
        tokens: compiled.bootTokens,
        sources: compiled.sources.length,
        spoke: workspace.id,
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
