import type { FastifyInstance } from 'fastify';
import type { ServerState, HealthResponse } from '../types.js';

export function healthRoute(app: FastifyInstance, state: ServerState): void {
  app.get('/health', async (): Promise<HealthResponse> => {
    const uptime = (Date.now() - state.startedAt.getTime()) / 1000;
    const graph = state.graph;

    return {
      status: state.rebuilding ? 'building' : 'ok',
      uptime,
      hubs: graph?.hubs.length ?? 0,
      spokes: graph?.hubs.reduce((n, h) => n + h.spokes.length, 0) ?? 0,
      lastBuild: state.lastBuild?.toISOString() ?? null,
      violations: state.violations,
    };
  });
}
