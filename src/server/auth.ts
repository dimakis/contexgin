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
    // Health endpoint is always public (ignore query params, fragments, etc.)
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === '/health') return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const provided = auth.slice(7);

    // HMAC-compare to avoid leaking token length via early length check.
    // Both sides are hashed to equal-length digests before comparison.
    const expectedHash = crypto.createHmac('sha256', expectedBuf).update(expectedBuf).digest();
    const providedHash = crypto
      .createHmac('sha256', expectedBuf)
      .update(Buffer.from(provided))
      .digest();

    if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
      reply.code(403).send({ error: 'Invalid token' });
      return;
    }
  });
}
