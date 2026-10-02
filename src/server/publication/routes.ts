import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { KnowledgePublisher } from './publisher.js';

export function publicationRoutes(
  app: FastifyInstance,
  publisher: KnowledgePublisher,
  secret: string,
  readToken?: string,
): void {
  if (!secret) throw new Error('Webhook secret required');
  if (readToken) {
    app.post<{ Params: { source: string } }>(
      '/api/publications/:source/retry',
      async (request, reply) => {
        if (request.headers.authorization !== `Bearer ${readToken}`)
          return reply.code(401).send({ error: 'Unauthorized' });
        if (!publisher.sources.some((s) => s.id === request.params.source))
          return reply.code(404).send({ error: 'Unknown source' });
        if (!publisher.requestRetry(request.params.source))
          return reply.code(429).send({ error: 'Retry is not eligible yet' });
        publisher.wake();
        return reply.code(202).send({ accepted: true });
      },
    );
    app.get<{ Params: { source: string } }>('/api/publications/:source', async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${readToken}`)
        return reply.code(401).send({ error: 'Unauthorized' });
      if (!publisher.sources.some((s) => s.id === request.params.source))
        return reply.code(404).send({ error: 'Unknown source' });
      return {
        current: publisher.current(request.params.source),
        status: publisher.status(request.params.source),
      };
    });
    app.post<{ Params: { source: string } }>(
      '/api/publications/:source/reconcile',
      async (request, reply) => {
        if (request.headers.authorization !== `Bearer ${readToken}`)
          return reply.code(401).send({ error: 'Unauthorized' });
        const id = request.params.source;
        if (!publisher.sources.some((s) => s.id === id))
          return reply.code(404).send({ error: 'Unknown source' });
        publisher.enqueue(id);
        await publisher.drain();
        const status = publisher.status(id);
        if (status.completed !== status.requested || status.error)
          return reply.code(503).send({ error: 'Fresh publication unavailable' });
        return { current: publisher.current(id) };
      },
    );
  }
  // Encapsulated parser preserves exact signed bytes without affecting other JSON routes.
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );
    scope.post('/api/publications/github', async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body)) return reply.code(415).send({ error: 'JSON body required' });
      const provided = request.headers['x-hub-signature-256'];
      const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      if (
        typeof provided !== 'string' ||
        Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
      )
        return reply.code(401).send({ error: 'Invalid signature' });
      const delivery = request.headers['x-github-delivery'];
      if (typeof delivery !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
        return reply.code(400).send({ error: 'Delivery id required' });
      let event: { ref?: string; repository?: { full_name?: string } };
      try {
        event = JSON.parse(body.toString());
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON' });
      }
      if (event === null || typeof event !== 'object')
        return reply.code(400).send({ error: 'Invalid event' });
      const matched =
        request.headers['x-github-event'] === 'push'
          ? publisher.sources.filter(
              (s) =>
                typeof s.githubRepository === 'string' &&
                s.githubRepository === event.repository?.full_name &&
                s.ref === event.ref,
            )
          : [];
      for (const source of matched) publisher.enqueue(source.id, delivery);
      // Durable SQLite transaction completed before ACK; fetch and compilation run separately.
      reply.code(202).send({ accepted: true, sources: matched.map((s) => s.id) });
      setImmediate(() => publisher.wake());
    });
  });
}
