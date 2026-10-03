import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from '../../src/server/auth.js';

describe('registerAuth', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
    // Add a test route
    app.get('/test', async () => ({ ok: true }));
    app.get('/health', async () => ({ status: 'ok' }));
  });

  afterEach(async () => {
    await app.close();
    delete process.env.CONTEXGIN_AUTH_TOKEN;
  });

  it('allows all requests when no token is set', async () => {
    delete process.env.CONTEXGIN_AUTH_TOKEN;
    registerAuth(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests without Authorization header when token is set', async () => {
    process.env.CONTEXGIN_AUTH_TOKEN = 'secret-token';
    registerAuth(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('Authorization');
  });

  it('rejects requests with wrong token', async () => {
    process.env.CONTEXGIN_AUTH_TOKEN = 'secret-token';
    registerAuth(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows requests with correct token', async () => {
    process.env.CONTEXGIN_AUTH_TOKEN = 'secret-token';
    registerAuth(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('always allows /health without auth', async () => {
    process.env.CONTEXGIN_AUTH_TOKEN = 'secret-token';
    registerAuth(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('allows /health with query params without auth', async () => {
    process.env.CONTEXGIN_AUTH_TOKEN = 'secret-token';
    registerAuth(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health?verbose=1' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-Bearer auth schemes', async () => {
    process.env.CONTEXGIN_AUTH_TOKEN = 'secret-token';
    registerAuth(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
  });
});
