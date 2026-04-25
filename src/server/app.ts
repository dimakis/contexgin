import Fastify, { type FastifyInstance } from 'fastify';
import { buildGraph } from '../graph/builder.js';
import { validateGraph } from '../graph/validate.js';
import { GraphStore } from './store.js';
import type { ServerConfig, ServerState } from './types.js';
import { healthRoute } from './routes/health.js';
import { compileRoute } from './routes/compile.js';
import { validateRoute } from './routes/validate.js';
import { graphRoutes } from './routes/graph.js';
import { GoalRegistry } from '../goals/registry.js';
import { goalRoutes } from '../goals/routes.js';
<<<<<<< HEAD
import { AgentLoader } from '../agents/loader.js';
import { agentRoutes } from '../agents/routes.js';
=======
import { agentRoutes } from './routes/agents.js';
>>>>>>> f9107bd (feat(recipe): add agent compiler and HTTP endpoints)

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
    violations: { errors: 0, warnings: 0, info: 0 },
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
  validateRoute(app, config);
  graphRoutes(app, state);

  // Goal registry
  const goalRegistry = new GoalRegistry(config.goalsDbPath);
  goalRoutes(app, goalRegistry);

<<<<<<< HEAD
  // Agent definitions
  const agentLoader = new AgentLoader(config.agentDefinitionPaths);
  await agentLoader.load();
  agentRoutes(app, agentLoader);
=======
  // Agent recipe routes
  agentRoutes(app, config);
>>>>>>> f9107bd (feat(recipe): add agent compiler and HTTP endpoints)

  // Serialize rebuilds — if one is in flight, the next caller waits for it
  let rebuildInFlight: Promise<void> | null = null;

  async function rebuild(): Promise<void> {
    if (config.roots.length === 0) return;
    if (rebuildInFlight) {
      // A rebuild is already running — wait for it instead of starting a second
      await rebuildInFlight;
      return;
    }
    rebuildInFlight = doRebuild();
    try {
      await rebuildInFlight;
    } finally {
      rebuildInFlight = null;
    }
  }

  async function doRebuild(): Promise<void> {
    state.rebuilding = true;
    const start = Date.now();
    try {
      state.graph = await buildGraph(config.roots);
      state.lastBuild = new Date();

      // Post-rebuild validation — surface drift on /health
      const validationViolations = await validateGraph(state.graph);
      const allViolations = [...state.graph.violations, ...validationViolations];
      state.violations = {
        errors: allViolations.filter((v) => v.severity === 'error').length,
        warnings: allViolations.filter((v) => v.severity === 'warning').length,
        info: allViolations.filter((v) => v.severity === 'info').length,
      };

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
    goalRegistry.close();
    store.close();
    await app.close();
  }

  return { app, state, store, rebuild, shutdown };
}
