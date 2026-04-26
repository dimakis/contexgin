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

/** TTL-based cache for agent discovery (avoids re-scanning filesystem on every request) */
const AGENT_CACHE_TTL_MS = 30_000; // 30 seconds
let agentCache: { agents: AgentLocation[]; rootsKey: string; expiresAt: number } | null = null;

/**
 * Discover agent definitions across all workspace roots.
 * Looks for .agents/ directory with .yaml/.yml files.
 * Results are cached for 30 seconds to avoid repeated filesystem scans.
 */
async function discoverAgents(roots: string[]): Promise<AgentLocation[]> {
  const rootsKey = roots.join('\0');
  const now = Date.now();

  if (agentCache && agentCache.rootsKey === rootsKey && now < agentCache.expiresAt) {
    return agentCache.agents;
  }

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

  agentCache = { agents, rootsKey, expiresAt: now + AGENT_CACHE_TTL_MS };
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

      // Validate that the resolved workspace is within an allowed root
      const resolvedWorkspace = path.resolve(workspaceRoot);
      const isAllowedRoot = config.roots.some((root) => {
        const resolvedRoot = path.resolve(root);
        return (
          resolvedWorkspace === resolvedRoot ||
          resolvedWorkspace.startsWith(resolvedRoot + path.sep)
        );
      });

      if (!isAllowedRoot) {
        return reply.status(403).send({
          error: `Workspace path not within allowed roots: ${workspaceRoot}`,
        });
      }

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
