// ── Agent Recipe Routes ────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import type { AgentLoader } from './loader.js';
import type { AgentRecipeResponse } from './types.js';
import { compileWithAdapters } from '../compiler/index.js';
import { resolveHome, validatePath } from './util.js';
import type { ServerConfig } from '../server/types.js';

export function agentRoutes(
  app: FastifyInstance,
  loader: AgentLoader,
  config: ServerConfig,
): void {
  // ── GET /api/agents ──────────────────────────────────────────
  // List all loaded agent definitions.

  app.get('/api/agents', async () => {
    const agents = loader.all().map((def) => ({
      name: def.identity.name,
      description: def.identity.description,
      mode: def.identity.mode,
      provider: def.provider.default,
      budget: def.context.budget,
    }));
    return { agents };
  });

  // ── GET /api/agents/:name ────────────────────────────────────
  // Return the raw agent definition.

  app.get<{ Params: { name: string } }>('/api/agents/:name', async (request, reply) => {
    const def = loader.get(request.params.name);
    if (!def) {
      return reply.status(404).send({ error: `Agent not found: ${request.params.name}` });
    }
    return def;
  });

  // ── GET /api/agents/:name/context ────────────────────────────
  // Compile boot context for an agent using its definition as the recipe.
  // This is the primary endpoint — the harness calls this at session start.

  app.get<{ Params: { name: string }; Querystring: { task?: string } }>(
    '/api/agents/:name/context',
    async (request, reply) => {
      const def = loader.get(request.params.name);
      if (!def) {
        return reply.status(404).send({ error: `Agent not found: ${request.params.name}` });
      }

      // Resolve hub paths from the agent definition
      const hubs = def.context.sources.hubs;
      if (hubs.length === 0) {
        return reply.status(400).send({ error: 'Agent definition has no source hubs' });
      }

      // Validate hub paths for path traversal and allowed roots
      for (const hub of hubs) {
        const validationError = validatePath(hub.path, config.roots);
        if (validationError) {
          return reply.status(400).send({
            error: `Invalid hub path ${hub.path}: ${validationError}`,
          });
        }
      }

      // Compile from the first hub (primary workspace)
      // Future: merge context from multiple hubs
      const primaryHub = resolveHome(hubs[0].path);

      try {
        const compiled = await compileWithAdapters({
          workspaceRoot: primaryHub,
          tokenBudget: def.context.budget,
          taskHint: request.query.task,
          excluded: def.context.exclude?.map((pattern) => [pattern]),
        });

        const response: AgentRecipeResponse = {
          agent: def.identity.name,
          provider: def.provider,
          boot: {
            context: compiled.bootPayload,
            tokens: compiled.bootTokens,
            sources: compiled.sources.length,
          },
          recipe: {
            profile: def.context.profile,
            memory: def.memory,
            output: def.output,
            governance: def.governance,
          },
        };

        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        request.log.error({ err, agent: def.identity.name }, 'Agent context compilation failed');
        return reply.status(500).send({ error: `Compilation failed: ${message}` });
      }
    },
  );
}
