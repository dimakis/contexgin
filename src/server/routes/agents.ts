/**
 * Agent recipe routes — compile context per agent definition.
 *
 * GET /api/agents                    — list discovered agent definitions
 * GET /api/agents/:name/context      — compile boot context for an agent
 */

import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { loadAgentDefinition, compileAgent } from '../../recipe/index.js';
import type { ServerConfig } from '../types.js';

interface AgentLocation {
  name: string;
  filePath: string;
  workspaceRoot: string;
}

/**
 * Discover agent definitions across all workspace roots.
 * Looks for .agents/ directory with .yaml/.yml files.
 */
async function discoverAgents(roots: string[]): Promise<AgentLocation[]> {
  const agents: AgentLocation[] = [];

  for (const root of roots) {
    const agentsDir = path.join(root, '.agents');
    try {
      const entries = await fs.readdir(agentsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
          const filePath = path.join(agentsDir, entry.name);
          try {
            const def = await loadAgentDefinition(filePath);
            agents.push({
              name: def.identity.name,
              filePath,
              workspaceRoot: root,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[agents] Failed to load ${entry.name}: ${msg}`);
          }
        }
      }
    } catch {
      // No .agents/ directory in this root — skip
    }
  }

  return agents;
}

export function agentRoutes(app: FastifyInstance, config: ServerConfig): void {
  // List all discovered agents
  app.get('/api/agents', async () => {
    const agents = await discoverAgents(config.roots);

    return {
      agents: agents.map((a) => ({
        name: a.name,
        filePath: a.filePath,
        workspaceRoot: a.workspaceRoot,
      })),
    };
  });

  // Compile context for a named agent
  app.get<{ Params: { name: string }; Querystring: { workspace?: string } }>(
    '/api/agents/:name/context',
    async (request, reply) => {
      const { name } = request.params;
      const workspaceOverride = request.query.workspace;

      // Find the agent definition
      const allAgents = await discoverAgents(config.roots);
      const agent = allAgents.find((a) => a.name === name);

      if (!agent) {
        return reply.status(404).send({
          error: `Agent not found: ${name}`,
          available: allAgents.map((a) => a.name),
        });
      }

      // Determine workspace root — use override or the root where the agent was found
      const workspaceRoot = workspaceOverride ?? agent.workspaceRoot;

      try {
        // Load and compile the agent definition
        const def = await loadAgentDefinition(agent.filePath);
        const compiled = await compileAgent(def, workspaceRoot);

        return {
          agent: name,
          identity: compiled.identity,
          boot: {
            content: compiled.bootContext.content,
            tokens: compiled.bootContext.tokens,
            sources: compiled.bootContext.sources,
          },
          contextBlocks: Object.fromEntries(
            Array.from(compiled.contextBlocks.entries()).map(([id, block]) => [
              id,
              {
                content: block.content,
                tokens: block.tokens,
                source: block.source,
              },
            ]),
          ),
          operational: compiled.operational
            ? {
                files: compiled.operational.files,
                delivery: compiled.operational.delivery,
              }
            : undefined,
          memory: compiled.memory,
          governance: compiled.governance,
          skills: compiled.skills,
          provider: compiled.provider,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        request.log.error({ err, agent: name }, 'Agent compilation failed');
        return reply.status(500).send({ error: `Compilation failed: ${message}` });
      }
    },
  );
}
