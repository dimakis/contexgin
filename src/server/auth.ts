/**
 * Bearer token authentication middleware for Fastify.
 * Reads expected token from CONTEXGIN_AUTH_TOKEN env var.
 * When set, all requests must include Authorization: Bearer <token>.
 * When unset, auth is disabled (local development mode).
 */

import * as crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export function registerAuth(app: FastifyInstance): void {
  const token = process.env.CONTEXGIN_AUTH_TOKEN;

  // No token configured — skip auth (local dev)
  if (!token) return;

  const expectedBuf = Buffer.from(token);

  app.addHook('onRequest', async (request, reply) => {
    // Health endpoint is always public (ignore query params)
    const pathname = request.url.split('?')[0];
    if (pathname === '/health') return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const provided = auth.slice(7);
    const providedBuf = Buffer.from(provided);

    // Timing-safe comparison — prevent brute-force via response timing
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      reply.code(403).send({ error: 'Invalid token' });
      return;
    }
  });
}
