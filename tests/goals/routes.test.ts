import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { GoalRegistry } from '../../src/goals/registry.js';
import { goalRoutes } from '../../src/goals/routes.js';

describe('Goal Routes', () => {
  let app: FastifyInstance;
  let registry: GoalRegistry;

  beforeEach(async () => {
    registry = new GoalRegistry(':memory:');
    app = Fastify({ logger: false });
    goalRoutes(app, registry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    registry.close();
  });

  // ── POST /api/goals ─────────────────────────────────────────

  describe('POST /api/goals', () => {
    it('creates a goal', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/goals',
        payload: { title: 'Ship feature X' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeTruthy();
      expect(body.title).toBe('Ship feature X');
      expect(body.status).toBe('active');
    });

    it('creates a goal with options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/goals',
        payload: {
          title: 'Ship feature X',
          description: 'Build it',
          successCriteria: ['Tests pass'],
          contextCondition: 'compiled',
          bootPayloadTokens: 5000,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.description).toBe('Build it');
      expect(body.successCriteria).toEqual(['Tests pass']);
    });

    it('returns 400 when title is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/goals',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── GET /api/goals ──────────────────────────────────────────

  describe('GET /api/goals', () => {
    it('lists all goals', async () => {
      registry.createGoal('Goal A');
      registry.createGoal('Goal B');

      const response = await app.inject({ method: 'GET', url: '/api/goals' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(2);
    });

    it('filters by status', async () => {
      const g = registry.createGoal('Goal A');
      registry.createGoal('Goal B');
      registry.updateGoal(g.id, { status: 'achieved', achievedAt: Date.now() / 1000 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/goals?status=active',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
    });
  });

  // ── GET /api/goals/:id ──────────────────────────────────────

  describe('GET /api/goals/:id', () => {
    it('returns goal with totals, contributions, and artifacts', async () => {
      const goal = registry.createGoal('Goal A');
      registry.addContribution(goal.id, {
        source: 'claude-code',
        sourceId: 'session-1',
        inputTokens: 1000,
      });
      registry.addArtifact(goal.id, { type: 'commit', ref: 'abc123' });

      const response = await app.inject({
        method: 'GET',
        url: `/api/goals/${goal.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.goal.id).toBe(goal.id);
      expect(body.goal.totals.inputTokens).toBe(1000);
      expect(body.contributions).toHaveLength(1);
      expect(body.artifacts).toHaveLength(1);
    });

    it('returns 404 for missing goal', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/goals/nonexistent',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/goals/:id ────────────────────────────────────

  describe('PATCH /api/goals/:id', () => {
    it('updates goal fields', async () => {
      const goal = registry.createGoal('Original');

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/goals/${goal.id}`,
        payload: { title: 'Updated', description: 'New desc' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.title).toBe('Updated');
      expect(body.description).toBe('New desc');
    });

    it('returns 404 for missing goal', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/goals/nonexistent',
        payload: { title: 'x' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/goals/:id ───────────────────────────────────

  describe('DELETE /api/goals/:id', () => {
    it('soft deletes a goal', async () => {
      const goal = registry.createGoal('Doomed');

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/goals/${goal.id}`,
      });

      expect(response.statusCode).toBe(200);
      const fetched = registry.getGoal(goal.id);
      expect(fetched!.status).toBe('abandoned');
    });

    it('returns 404 for missing goal', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/goals/nonexistent',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── POST /api/goals/:id/contributions ───────────────────────

  describe('POST /api/goals/:id/contributions', () => {
    it('adds a contribution', async () => {
      const goal = registry.createGoal('Goal');

      const response = await app.inject({
        method: 'POST',
        url: `/api/goals/${goal.id}/contributions`,
        payload: {
          source: 'claude-code',
          sourceId: 'session-1',
          inputTokens: 1000,
          outputTokens: 500,
          costUsd: 0.05,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeTruthy();
      expect(body.goalId).toBe(goal.id);
    });

    it('returns 400 when source is missing', async () => {
      const goal = registry.createGoal('Goal');

      const response = await app.inject({
        method: 'POST',
        url: `/api/goals/${goal.id}/contributions`,
        payload: { sourceId: 'session-1' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for missing goal', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/goals/nonexistent/contributions',
        payload: { source: 'claude-code', sourceId: 'session-1' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── GET /api/goals/:id/contributions ────────────────────────

  describe('GET /api/goals/:id/contributions', () => {
    it('lists contributions', async () => {
      const goal = registry.createGoal('Goal');
      registry.addContribution(goal.id, {
        source: 'claude-code',
        sourceId: 'session-1',
        inputTokens: 1000,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/goals/${goal.id}/contributions`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
    });
  });

  // ── POST /api/goals/:id/artifacts ───────────────────────────

  describe('POST /api/goals/:id/artifacts', () => {
    it('links an artifact', async () => {
      const goal = registry.createGoal('Goal');

      const response = await app.inject({
        method: 'POST',
        url: `/api/goals/${goal.id}/artifacts`,
        payload: { type: 'commit', ref: 'abc123', repo: 'dimakis/contexgin' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeTruthy();
      expect(body.type).toBe('commit');
    });

    it('returns 400 when type or ref is missing', async () => {
      const goal = registry.createGoal('Goal');

      const response = await app.inject({
        method: 'POST',
        url: `/api/goals/${goal.id}/artifacts`,
        payload: { type: 'commit' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for missing goal', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/goals/nonexistent/artifacts',
        payload: { type: 'commit', ref: 'abc123' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── GET /api/goals/:id/artifacts ────────────────────────────

  describe('GET /api/goals/:id/artifacts', () => {
    it('lists artifacts', async () => {
      const goal = registry.createGoal('Goal');
      registry.addArtifact(goal.id, { type: 'commit', ref: 'abc123' });

      const response = await app.inject({
        method: 'GET',
        url: `/api/goals/${goal.id}/artifacts`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
    });
  });
});
