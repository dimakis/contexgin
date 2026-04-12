import type { FastifyInstance } from 'fastify';
import type { ServerState, GraphResponse } from '../types.js';

export function graphRoutes(app: FastifyInstance, state: ServerState): void {
  app.get('/graph', async (_request, reply) => {
    if (!state.graph) {
      return reply.status(503).send({ error: 'Graph not built yet' });
    }
    return formatGraphResponse({ graph: state.graph });
  });

  app.get<{ Params: { hubId: string } }>('/graph/:hubId', async (request, reply) => {
    if (!state.graph) {
      return reply.status(503).send({ error: 'Graph not built yet' });
    }

    const hub = state.graph.hubs.find(
      (h) => h.id === request.params.hubId || h.name === request.params.hubId,
    );
    if (!hub) {
      return reply.status(404).send({ error: `Hub not found: ${request.params.hubId}` });
    }

    // Return just this hub's subgraph
    const hubEdges = state.graph.edges.filter(
      (e) => e.from.startsWith(hub.id) || e.to.startsWith(hub.id),
    );

    const response: GraphResponse = {
      hubs: [formatHub(hub)],
      edges: hubEdges,
      violations: state.graph.violations.filter(
        (v) => v.location.startsWith(hub.name) || v.location.startsWith(hub.path),
      ).length,
    };

    return response;
  });
}

function formatGraphResponse(state: {
  graph: NonNullable<import('../types.js').ServerState['graph']>;
}): GraphResponse {
  const { graph } = state;
  return {
    hubs: graph.hubs.map(formatHub),
    edges: graph.edges,
    violations: graph.violations.length,
  };
}

function formatHub(hub: import('../../graph/types.js').Hub) {
  return {
    id: hub.id,
    name: hub.name,
    path: hub.path,
    purpose: hub.constitution.purpose,
    spokes: hub.spokes.map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
      confidentiality: s.confidentiality,
      hasConstitution: s.constitution !== null,
    })),
    externals: hub.externals,
  };
}
