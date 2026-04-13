import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadTasks,
  loadTask,
  computeDelta,
  extractRunCondition,
  saveResult,
  loadResults,
} from '../../src/benchmarks/runner.js';
import type { RunCondition, BenchmarkResult } from '../../src/benchmarks/types.js';
import type { Goal } from '../../src/goals/types.js';

// ── Helpers ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'bench-test-'));
}

function writeTask(dir: string, filename: string, task: Record<string, unknown>): void {
  writeFileSync(join(dir, filename), JSON.stringify(task));
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    title: 'Test goal',
    description: null,
    successCriteria: [],
    status: 'achieved',
    contextCondition: 'none',
    bootPayloadTokens: null,
    createdAt: Date.now() / 1000,
    achievedAt: Date.now() / 1000,
    totals: {
      inputTokens: 45000,
      outputTokens: 3200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.38,
      turns: 6,
      toolCalls: 12,
      durationMs: 45000,
      durationApiMs: 30000,
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('loadTasks', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('loads and sorts task files alphabetically', () => {
    writeTask(dir, '02-second.json', { id: '02-second', title: 'Second' });
    writeTask(dir, '01-first.json', { id: '01-first', title: 'First' });
    writeTask(dir, '03-third.json', { id: '03-third', title: 'Third' });

    const tasks = loadTasks(dir);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe('01-first');
    expect(tasks[1].id).toBe('02-second');
    expect(tasks[2].id).toBe('03-third');
  });

  it('ignores non-json files', () => {
    writeTask(dir, '01-task.json', { id: '01-task' });
    writeFileSync(join(dir, 'README.md'), '# hello');

    const tasks = loadTasks(dir);
    expect(tasks).toHaveLength(1);
  });

  it('returns empty array for empty directory', () => {
    const tasks = loadTasks(dir);
    expect(tasks).toHaveLength(0);
  });
});

describe('loadTask', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    writeTask(dir, '01-alpha.json', { id: '01-alpha', title: 'Alpha' });
    writeTask(dir, '02-beta.json', { id: '02-beta', title: 'Beta' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('finds task by id', () => {
    const task = loadTask(dir, '02-beta');
    expect(task).not.toBeNull();
    expect(task!.title).toBe('Beta');
  });

  it('returns null for missing task', () => {
    const task = loadTask(dir, 'nonexistent');
    expect(task).toBeNull();
  });
});

describe('computeDelta', () => {
  it('computes percentage reductions', () => {
    const without: RunCondition = {
      goalId: 'a',
      inputTokens: 45000,
      outputTokens: 5000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 6,
      toolCalls: 12,
      costUsd: 0.38,
      durationMs: 45000,
      success: true,
    };

    const withCtx: RunCondition = {
      goalId: 'b',
      inputTokens: 16000,
      outputTokens: 2000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 2,
      toolCalls: 3,
      costUsd: 0.14,
      durationMs: 12000,
      success: true,
    };

    const delta = computeDelta(without, withCtx);
    expect(delta.tokenReduction).toBe('64%');
    expect(delta.costReduction).toBe('63%');
    expect(delta.turnReduction).toBe('67%');
    expect(delta.toolCallReduction).toBe('75%');
  });

  it('handles zero baseline gracefully', () => {
    const zero: RunCondition = {
      goalId: 'a',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 0,
      toolCalls: 0,
      costUsd: 0,
      durationMs: 0,
      success: true,
    };

    const delta = computeDelta(zero, zero);
    expect(delta.tokenReduction).toBe('0%');
    expect(delta.costReduction).toBe('0%');
  });

  it('handles negative delta (context was worse)', () => {
    const without: RunCondition = {
      goalId: 'a',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 2,
      toolCalls: 3,
      costUsd: 0.05,
      durationMs: 5000,
      success: true,
    };

    const withCtx: RunCondition = {
      goalId: 'b',
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 4,
      toolCalls: 6,
      costUsd: 0.1,
      durationMs: 10000,
      success: true,
    };

    const delta = computeDelta(without, withCtx);
    expect(delta.tokenReduction).toBe('-100%');
    expect(delta.costReduction).toBe('-100%');
  });
});

describe('extractRunCondition', () => {
  it('extracts condition from goal with contributions', () => {
    const goal = makeGoal({ id: 'goal-abc', status: 'achieved' });
    const condition = extractRunCondition({ goal, contributions: [] });

    expect(condition.goalId).toBe('goal-abc');
    expect(condition.inputTokens).toBe(45000);
    expect(condition.outputTokens).toBe(3200);
    expect(condition.turns).toBe(6);
    expect(condition.toolCalls).toBe(12);
    expect(condition.costUsd).toBe(0.38);
    expect(condition.success).toBe(true);
  });

  it('marks non-achieved goals as not successful', () => {
    const goal = makeGoal({ status: 'failed' });
    const condition = extractRunCondition({ goal, contributions: [] });
    expect(condition.success).toBe(false);
  });

  it('includes bootPayloadTokens when present', () => {
    const goal = makeGoal({ bootPayloadTokens: 3200 });
    const condition = extractRunCondition({ goal, contributions: [] });
    expect(condition.bootPayloadTokens).toBe(3200);
  });

  it('omits bootPayloadTokens when null', () => {
    const goal = makeGoal({ bootPayloadTokens: null });
    const condition = extractRunCondition({ goal, contributions: [] });
    expect(condition.bootPayloadTokens).toBeUndefined();
  });
});

describe('saveResult / loadResults', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('saves and loads results round-trip', () => {
    const result: BenchmarkResult = {
      taskId: '01-entry-points',
      timestamp: '2026-04-12T14:00:00.000Z',
      model: 'claude-sonnet-4-6',
      withoutContext: {
        goalId: 'a',
        inputTokens: 45000,
        outputTokens: 3200,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 6,
        toolCalls: 12,
        costUsd: 0.38,
        durationMs: 45000,
        success: true,
      },
      withContext: {
        goalId: 'b',
        inputTokens: 18000,
        outputTokens: 1800,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 2,
        toolCalls: 3,
        costUsd: 0.14,
        durationMs: 12000,
        success: true,
        bootPayloadTokens: 3200,
      },
      delta: {
        tokenReduction: '60%',
        costReduction: '63%',
        turnReduction: '67%',
        toolCallReduction: '75%',
      },
    };

    const filepath = saveResult(dir, result);
    expect(filepath).toContain('01-entry-points');

    const loaded = loadResults(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].taskId).toBe('01-entry-points');
    expect(loaded[0].delta.tokenReduction).toBe('60%');
  });

  it('loads multiple results sorted by filename', () => {
    const base: BenchmarkResult = {
      taskId: '',
      timestamp: '',
      model: 'claude-sonnet-4-6',
      withoutContext: {
        goalId: 'a',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 0,
        toolCalls: 0,
        costUsd: 0,
        durationMs: 0,
        success: true,
      },
      withContext: {
        goalId: 'b',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 0,
        toolCalls: 0,
        costUsd: 0,
        durationMs: 0,
        success: true,
      },
      delta: {
        tokenReduction: '0%',
        costReduction: '0%',
        turnReduction: '0%',
        toolCallReduction: '0%',
      },
    };

    saveResult(dir, { ...base, taskId: '02-second', timestamp: '2026-04-12T15:00:00.000Z' });
    saveResult(dir, { ...base, taskId: '01-first', timestamp: '2026-04-12T14:00:00.000Z' });

    const loaded = loadResults(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].taskId).toBe('01-first');
    expect(loaded[1].taskId).toBe('02-second');
  });
});
