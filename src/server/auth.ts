/**
 * Bearer token authentication middleware for Fastify.
 * Reads expected token from CONTEXGIN_AUTH_TOKEN env var.
 * When set, all requests must include Authorization: Bearer <token>.
 * When unset, auth is disabled (local development mode).
 */

import type { FastifyInstance } from 'fastify';

export function registerAuth(app: FastifyInstance): void {
  const token = process.env.CONTEXGIN_AUTH_TOKEN;

  // No token configured — skip auth (local dev)
  if (!token) return;

  app.addHook('onRequest', async (request, reply) => {
    // Health endpoint is always public
    if (request.url === '/health') return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const provided = auth.slice(7);
    if (provided !== token) {
      reply.code(403).send({ error: 'Invalid token' });
      return;
    }
  });
}
