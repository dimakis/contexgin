import Fastify, { type FastifyInstance } from 'fastify';
import { buildGraph } from '../graph/builder.js';
import { GraphStore } from './store.js';
import type { ServerConfig, ServerState } from './types.js';
import { healthRoute } from './routes/health.js';
import { compileRoute } from './routes/compile.js';
import { validateRoute } from './routes/validate.js';
import { graphRoutes } from './routes/graph.js';

export interface ContexGinServer {
  app: FastifyInstance;
  state: ServerState;
  store: GraphStore;
  rebuild: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export async function createServer(config: ServerConfig): Promise<ContexGinServer> {
  const app = Fastify({ logger: false });
  const store = new GraphStore(config.dbPath);

  const state: ServerState = {
    graph: null,
    lastBuild: null,
    startedAt: new Date(),
    rebuilding: false,
  };

  // Restore from latest snapshot if available
  const snapshot = store.getLatestSnapshot();
  if (snapshot) {
    state.graph = snapshot.graph;
    state.lastBuild = new Date(snapshot.timestamp);
  }

  // Register routes
  healthRoute(app, state);
  compileRoute(app, state);
  validateRoute(app, state, config);
  graphRoutes(app, state);

  async function rebuild(): Promise<void> {
    if (config.roots.length === 0) return;
    state.rebuilding = true;
    const start = Date.now();
    try {
      state.graph = await buildGraph(config.roots);
      state.lastBuild = new Date();
      const duration = Date.now() - start;
      store.saveSnapshot(state.graph);
      store.recordBuild(duration, 'rebuild', true);
    } catch (err) {
      const duration = Date.now() - start;
      store.recordBuild(duration, 'rebuild', false, (err as Error).message);
      throw err;
    } finally {
      state.rebuilding = false;
    }
  }

  async function shutdown(): Promise<void> {
    store.close();
    await app.close();
  }

  return { app, state, store, rebuild, shutdown };
}
