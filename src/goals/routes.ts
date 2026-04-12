import type { FastifyInstance } from 'fastify';
import type { GoalRegistry } from './registry.js';
import type { GoalStatus, ContextCondition } from './types.js';

// ── Validation helpers ────────────────────────────────────────

const VALID_STATUSES: GoalStatus[] = ['active', 'achieved', 'failed', 'abandoned'];
const VALID_CONTEXT_CONDITIONS: ContextCondition[] = ['none', 'compiled', 'partial', 'unknown'];

function isValidStatus(value: unknown): value is GoalStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as GoalStatus);
}

function isValidContextCondition(value: unknown): value is ContextCondition {
  return typeof value === 'string' && VALID_CONTEXT_CONDITIONS.includes(value as ContextCondition);
}

// ── Routes ────────────────────────────────────────────────────

export function goalRoutes(app: FastifyInstance, registry: GoalRegistry): void {
  // ── POST /api/goals ───────────────────────────────────────

  app.post('/api/goals', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body.title !== 'string' || !body.title) {
      return reply.status(400).send({ error: 'title is required' });
    }

    // Validate contextCondition if provided
    if (body.contextCondition !== undefined && !isValidContextCondition(body.contextCondition)) {
      return reply.status(400).send({
        error: `Invalid contextCondition. Must be one of: ${VALID_CONTEXT_CONDITIONS.join(', ')}`,
      });
    }

    const goal = registry.createGoal(body.title, {
      description: typeof body.description === 'string' ? body.description : undefined,
      successCriteria: Array.isArray(body.successCriteria) ? body.successCriteria : undefined,
      contextCondition: isValidContextCondition(body.contextCondition)
        ? body.contextCondition
        : undefined,
      bootPayloadTokens:
        typeof body.bootPayloadTokens === 'number' ? body.bootPayloadTokens : undefined,
    });

    return reply.status(201).send(goal);
  });

  // ── GET /api/goals ────────────────────────────────────────

  app.get('/api/goals', async (request, reply) => {
    const query = request.query as Record<string, string>;

    // Validate status if provided
    if (query.status && !isValidStatus(query.status)) {
      return reply.status(400).send({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const status = query.status as GoalStatus | undefined;
    return registry.listGoals(status ? { status } : undefined);
  });

  // ── GET /api/goals/:id ────────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/goals/:id', async (request, reply) => {
    const goal = registry.getGoal(request.params.id);
    if (!goal) {
      return reply.status(404).send({ error: 'Goal not found' });
    }

    const contributions = registry.getContributions(goal.id);
    const artifacts = registry.getArtifacts(goal.id);

    return { goal, contributions, artifacts };
  });

  // ── PATCH /api/goals/:id ──────────────────────────────────

  app.patch<{ Params: { id: string } }>('/api/goals/:id', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;

    // Validate status if provided
    if (body?.status !== undefined && !isValidStatus(body.status)) {
      return reply.status(400).send({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    // Validate contextCondition if provided
    if (body?.contextCondition !== undefined && !isValidContextCondition(body.contextCondition)) {
      return reply.status(400).send({
        error: `Invalid contextCondition. Must be one of: ${VALID_CONTEXT_CONDITIONS.join(', ')}`,
      });
    }

    const updated = registry.updateGoal(request.params.id, {
      title: typeof body?.title === 'string' ? body.title : undefined,
      description:
        body?.description !== undefined ? (body.description as string | null) : undefined,
      successCriteria: Array.isArray(body?.successCriteria) ? body.successCriteria : undefined,
      status: isValidStatus(body?.status) ? body.status : undefined,
      contextCondition: isValidContextCondition(body?.contextCondition)
        ? body.contextCondition
        : undefined,
      bootPayloadTokens:
        body?.bootPayloadTokens !== undefined
          ? (body.bootPayloadTokens as number | null)
          : undefined,
      achievedAt: body?.achievedAt !== undefined ? (body.achievedAt as number | null) : undefined,
    });

    if (!updated) {
      return reply.status(404).send({ error: 'Goal not found' });
    }

    return updated;
  });

  // ── DELETE /api/goals/:id ─────────────────────────────────

  app.delete<{ Params: { id: string } }>('/api/goals/:id', async (request, reply) => {
    const deleted = registry.deleteGoal(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Goal not found' });
    }
    return { ok: true };
  });

  // ── POST /api/goals/:id/contributions ─────────────────────

  app.post<{ Params: { id: string } }>('/api/goals/:id/contributions', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body.source !== 'string' || typeof body.sourceId !== 'string') {
      return reply.status(400).send({ error: 'source and sourceId are required' });
    }

    try {
      const contribution = registry.addContribution(request.params.id, {
        source: body.source,
        sourceId: body.sourceId,
        sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel : undefined,
        inputTokens: typeof body.inputTokens === 'number' ? body.inputTokens : undefined,
        outputTokens: typeof body.outputTokens === 'number' ? body.outputTokens : undefined,
        cacheReadTokens:
          typeof body.cacheReadTokens === 'number' ? body.cacheReadTokens : undefined,
        cacheCreationTokens:
          typeof body.cacheCreationTokens === 'number' ? body.cacheCreationTokens : undefined,
        costUsd: typeof body.costUsd === 'number' ? body.costUsd : undefined,
        turns: typeof body.turns === 'number' ? body.turns : undefined,
        toolCalls: typeof body.toolCalls === 'number' ? body.toolCalls : undefined,
        durationMs: typeof body.durationMs === 'number' ? body.durationMs : undefined,
        durationApiMs: typeof body.durationApiMs === 'number' ? body.durationApiMs : undefined,
        metadata:
          typeof body.metadata === 'object' && body.metadata !== null
            ? (body.metadata as Record<string, unknown>)
            : undefined,
      });

      return reply.status(201).send(contribution);
    } catch (err) {
      if ((err as Error).message.includes('Goal not found')) {
        return reply.status(404).send({ error: 'Goal not found' });
      }
      throw err;
    }
  });

  // ── GET /api/goals/:id/contributions ──────────────────────

  app.get<{ Params: { id: string } }>('/api/goals/:id/contributions', async (request) => {
    return registry.getContributions(request.params.id);
  });

  // ── POST /api/goals/:id/artifacts ─────────────────────────

  app.post<{ Params: { id: string } }>('/api/goals/:id/artifacts', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body.type !== 'string' || typeof body.ref !== 'string') {
      return reply.status(400).send({ error: 'type and ref are required' });
    }

    try {
      const artifact = registry.addArtifact(request.params.id, {
        type: body.type,
        ref: body.ref,
        repo: typeof body.repo === 'string' ? body.repo : undefined,
      });

      return reply.status(201).send(artifact);
    } catch (err) {
      if ((err as Error).message.includes('Goal not found')) {
        return reply.status(404).send({ error: 'Goal not found' });
      }
      throw err;
    }
  });

  // ── GET /api/goals/:id/artifacts ──────────────────────────

  app.get<{ Params: { id: string } }>('/api/goals/:id/artifacts', async (request) => {
    return registry.getArtifacts(request.params.id);
  });
}
