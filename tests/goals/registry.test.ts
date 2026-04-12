import { describe, it, expect, afterEach } from 'vitest';
import { GoalRegistry } from '../../src/goals/registry.js';

describe('GoalRegistry', () => {
  let registry: GoalRegistry;

  afterEach(() => {
    if (registry) registry.close();
  });

  // ── DB migration ────────────────────────────────────────────

  it('creates tables on initialization', () => {
    registry = new GoalRegistry(':memory:');
    // No throw = success
  });

  // ── Create / Get / List ─────────────────────────────────────

  it('creates a goal with generated id', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Ship feature X');

    expect(goal.id).toBeTruthy();
    expect(goal.title).toBe('Ship feature X');
    expect(goal.status).toBe('active');
    expect(goal.contextCondition).toBe('unknown');
    expect(goal.description).toBeNull();
    expect(goal.successCriteria).toEqual([]);
    expect(goal.createdAt).toBeGreaterThan(0);
    expect(goal.achievedAt).toBeNull();
    expect(goal.totals.inputTokens).toBe(0);
  });

  it('creates a goal with options', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Ship feature X', {
      description: 'Build the thing',
      successCriteria: ['Tests pass', 'PR merged'],
      contextCondition: 'compiled',
      bootPayloadTokens: 5000,
    });

    expect(goal.description).toBe('Build the thing');
    expect(goal.successCriteria).toEqual(['Tests pass', 'PR merged']);
    expect(goal.contextCondition).toBe('compiled');
    expect(goal.bootPayloadTokens).toBe(5000);
  });

  it('gets a goal by id', () => {
    registry = new GoalRegistry(':memory:');
    const created = registry.createGoal('Ship feature X');
    const fetched = registry.getGoal(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe('Ship feature X');
  });

  it('returns null for missing goal', () => {
    registry = new GoalRegistry(':memory:');
    expect(registry.getGoal('nonexistent')).toBeNull();
  });

  it('lists goals', () => {
    registry = new GoalRegistry(':memory:');
    registry.createGoal('Goal A');
    registry.createGoal('Goal B');

    const goals = registry.listGoals();
    expect(goals).toHaveLength(2);
  });

  it('lists goals filtered by status', () => {
    registry = new GoalRegistry(':memory:');
    const g1 = registry.createGoal('Goal A');
    registry.createGoal('Goal B');
    registry.updateGoal(g1.id, { status: 'achieved', achievedAt: Date.now() / 1000 });

    const active = registry.listGoals({ status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe('Goal B');

    const achieved = registry.listGoals({ status: 'achieved' });
    expect(achieved).toHaveLength(1);
    expect(achieved[0].title).toBe('Goal A');
  });

  // ── Update ──────────────────────────────────────────────────

  it('updates goal fields', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Original title');

    const updated = registry.updateGoal(goal.id, {
      title: 'New title',
      description: 'Added description',
      successCriteria: ['Criterion 1'],
      contextCondition: 'compiled',
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New title');
    expect(updated!.description).toBe('Added description');
    expect(updated!.successCriteria).toEqual(['Criterion 1']);
    expect(updated!.contextCondition).toBe('compiled');
  });

  it('returns null when updating nonexistent goal', () => {
    registry = new GoalRegistry(':memory:');
    expect(registry.updateGoal('nonexistent', { title: 'x' })).toBeNull();
  });

  // ── Delete (soft) ───────────────────────────────────────────

  it('soft deletes a goal by setting status to abandoned', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Doomed goal');

    const deleted = registry.deleteGoal(goal.id);
    expect(deleted).toBe(true);

    const fetched = registry.getGoal(goal.id);
    expect(fetched!.status).toBe('abandoned');
  });

  it('returns false when deleting nonexistent goal', () => {
    registry = new GoalRegistry(':memory:');
    expect(registry.deleteGoal('nonexistent')).toBe(false);
  });

  // ── Contributions ───────────────────────────────────────────

  it('adds a contribution and computes totals', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Goal with usage');

    registry.addContribution(goal.id, {
      source: 'claude-code',
      sourceId: 'session-1',
      sourceLabel: 'Session 1',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      costUsd: 0.05,
      turns: 3,
      toolCalls: 5,
      durationMs: 30000,
      durationApiMs: 15000,
    });

    const fetched = registry.getGoal(goal.id);
    expect(fetched!.totals.inputTokens).toBe(1000);
    expect(fetched!.totals.outputTokens).toBe(500);
    expect(fetched!.totals.cacheReadTokens).toBe(200);
    expect(fetched!.totals.cacheCreationTokens).toBe(100);
    expect(fetched!.totals.costUsd).toBeCloseTo(0.05);
    expect(fetched!.totals.turns).toBe(3);
    expect(fetched!.totals.toolCalls).toBe(5);
    expect(fetched!.totals.durationMs).toBe(30000);
    expect(fetched!.totals.durationApiMs).toBe(15000);
  });

  it('sums multiple contributions', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Goal with many contributions');

    registry.addContribution(goal.id, {
      source: 'claude-code',
      sourceId: 'session-1',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
      turns: 3,
    });

    registry.addContribution(goal.id, {
      source: 'claude-code',
      sourceId: 'session-2',
      inputTokens: 2000,
      outputTokens: 800,
      costUsd: 0.08,
      turns: 5,
    });

    const fetched = registry.getGoal(goal.id);
    expect(fetched!.totals.inputTokens).toBe(3000);
    expect(fetched!.totals.outputTokens).toBe(1300);
    expect(fetched!.totals.costUsd).toBeCloseTo(0.13);
    expect(fetched!.totals.turns).toBe(8);
  });

  it('lists contributions for a goal', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Goal');

    registry.addContribution(goal.id, {
      source: 'claude-code',
      sourceId: 'session-1',
      inputTokens: 1000,
    });

    registry.addContribution(goal.id, {
      source: 'mitzo',
      sourceId: 'task-1',
      inputTokens: 500,
    });

    const contributions = registry.getContributions(goal.id);
    expect(contributions).toHaveLength(2);
    expect(contributions[0].source).toBe('claude-code');
    expect(contributions[1].source).toBe('mitzo');
  });

  it('throws when adding contribution to nonexistent goal', () => {
    registry = new GoalRegistry(':memory:');
    expect(() =>
      registry.addContribution('nonexistent', {
        source: 'claude-code',
        sourceId: 'session-1',
      }),
    ).toThrow();
  });

  it('stores contribution metadata as JSON', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Goal');

    registry.addContribution(goal.id, {
      source: 'claude-code',
      sourceId: 'session-1',
      metadata: { branch: 'feat/x', commit: 'abc123' },
    });

    const contributions = registry.getContributions(goal.id);
    expect(contributions[0].metadata).toEqual({ branch: 'feat/x', commit: 'abc123' });
  });

  // ── Concurrent contributions ────────────────────────────────

  it('handles concurrent contributions to same goal', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Concurrent goal');

    // Simulate concurrent writes (sync in better-sqlite3, but validates integrity)
    for (let i = 0; i < 20; i++) {
      registry.addContribution(goal.id, {
        source: 'claude-code',
        sourceId: `session-${i}`,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        turns: 1,
      });
    }

    const fetched = registry.getGoal(goal.id);
    expect(fetched!.totals.inputTokens).toBe(2000);
    expect(fetched!.totals.outputTokens).toBe(1000);
    expect(fetched!.totals.turns).toBe(20);

    const contributions = registry.getContributions(goal.id);
    expect(contributions).toHaveLength(20);
  });

  // ── Artifacts ───────────────────────────────────────────────

  it('adds and lists artifacts', () => {
    registry = new GoalRegistry(':memory:');
    const goal = registry.createGoal('Goal with artifacts');

    registry.addArtifact(goal.id, {
      type: 'commit',
      ref: 'abc123',
      repo: 'dimakis/contexgin',
    });

    registry.addArtifact(goal.id, {
      type: 'pr',
      ref: '42',
      repo: 'dimakis/contexgin',
    });

    const artifacts = registry.getArtifacts(goal.id);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].type).toBe('commit');
    expect(artifacts[0].ref).toBe('abc123');
    expect(artifacts[0].repo).toBe('dimakis/contexgin');
    expect(artifacts[1].type).toBe('pr');
  });

  it('throws when adding artifact to nonexistent goal', () => {
    registry = new GoalRegistry(':memory:');
    expect(() => registry.addArtifact('nonexistent', { type: 'commit', ref: 'abc123' })).toThrow();
  });

  // ── Usage Summary ───────────────────────────────────────────

  it('computes usage summary across all goals', () => {
    registry = new GoalRegistry(':memory:');

    const g1 = registry.createGoal('Goal 1');
    const g2 = registry.createGoal('Goal 2');

    registry.addContribution(g1.id, {
      source: 'claude-code',
      sourceId: 'session-1',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
      turns: 3,
    });

    registry.addContribution(g2.id, {
      source: 'claude-code',
      sourceId: 'session-2',
      inputTokens: 2000,
      outputTokens: 800,
      costUsd: 0.08,
      turns: 5,
    });

    registry.updateGoal(g1.id, { status: 'achieved', achievedAt: Date.now() / 1000 });

    const summary = registry.getUsageSummary();
    expect(summary.totalGoals).toBe(2);
    expect(summary.activeGoals).toBe(1);
    expect(summary.achievedGoals).toBe(1);
    expect(summary.totals.inputTokens).toBe(3000);
    expect(summary.totals.outputTokens).toBe(1300);
    expect(summary.totals.costUsd).toBeCloseTo(0.13);
    expect(summary.totals.turns).toBe(8);
  });

  it('returns zero summary when no goals exist', () => {
    registry = new GoalRegistry(':memory:');
    const summary = registry.getUsageSummary();

    expect(summary.totalGoals).toBe(0);
    expect(summary.activeGoals).toBe(0);
    expect(summary.totals.inputTokens).toBe(0);
  });
});
