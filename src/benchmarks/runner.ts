import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  TaskDefinition,
  RunCondition,
  BenchmarkResult,
  BenchmarkDelta,
  RunnerConfig,
} from './types.js';
import type { Goal } from '../goals/types.js';

// ── Goal Registry Client ─────────────────────────────────────

interface GoalWithContributions {
  goal: Goal;
  contributions: Array<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
    turns: number;
    toolCalls: number;
    durationMs: number;
  }>;
}

async function createGoal(
  baseUrl: string,
  title: string,
  opts: {
    description?: string;
    successCriteria?: string[];
    contextCondition?: string;
  },
): Promise<Goal> {
  const res = await fetch(`${baseUrl}/api/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description: opts.description,
      successCriteria: opts.successCriteria,
      contextCondition: opts.contextCondition,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create goal: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as Goal;
}

async function getGoalWithContributions(
  baseUrl: string,
  goalId: string,
): Promise<GoalWithContributions> {
  const res = await fetch(`${baseUrl}/api/goals/${goalId}`);

  if (!res.ok) {
    throw new Error(`Failed to get goal: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as GoalWithContributions;
}

async function markGoalAchieved(baseUrl: string, goalId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/goals/${goalId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'achieved', achievedAt: Date.now() / 1000 }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update goal: ${res.status} ${await res.text()}`);
  }
}

// ── Task Loading ─────────────────────────────────────────────

export function loadTasks(tasksDir: string): TaskDefinition[] {
  const files = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
  files.sort();

  return files.map((f) => {
    const content = readFileSync(join(tasksDir, f), 'utf-8');
    return JSON.parse(content) as TaskDefinition;
  });
}

export function loadTask(tasksDir: string, taskId: string): TaskDefinition | null {
  const files = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));

  for (const f of files) {
    const content = readFileSync(join(tasksDir, f), 'utf-8');
    const task = JSON.parse(content) as TaskDefinition;
    if (task.id === taskId) return task;
  }

  return null;
}

// ── Delta Computation ────────────────────────────────────────

export function computeDelta(without: RunCondition, withCtx: RunCondition): BenchmarkDelta {
  const totalWithout = without.inputTokens + without.outputTokens;
  const totalWith = withCtx.inputTokens + withCtx.outputTokens;

  return {
    tokenReduction: formatPercent(totalWithout, totalWith),
    costReduction: formatPercent(without.costUsd, withCtx.costUsd),
    turnReduction: formatPercent(without.turns, withCtx.turns),
    toolCallReduction: formatPercent(without.toolCalls, withCtx.toolCalls),
  };
}

function formatPercent(before: number, after: number): string {
  if (before === 0) return '0%';
  const reduction = ((before - after) / before) * 100;
  return `${Math.round(reduction)}%`;
}

// ── Result Extraction ────────────────────────────────────────

export function extractRunCondition(data: GoalWithContributions): RunCondition {
  const totals = data.goal.totals;

  return {
    goalId: data.goal.id,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    turns: totals.turns,
    toolCalls: totals.toolCalls,
    costUsd: totals.costUsd,
    durationMs: totals.durationMs,
    success: data.goal.status === 'achieved',
    bootPayloadTokens: data.goal.bootPayloadTokens ?? undefined,
  };
}

// ── Result Storage ───────────────────────────────────────────

export function saveResult(resultsDir: string, result: BenchmarkResult): string {
  const filename = `${result.taskId}_${result.timestamp.replace(/[:.]/g, '-')}.json`;
  const filepath = join(resultsDir, filename);
  writeFileSync(filepath, JSON.stringify(result, null, 2) + '\n');
  return filepath;
}

export function loadResults(resultsDir: string): BenchmarkResult[] {
  const files = readdirSync(resultsDir).filter((f) => f.endsWith('.json'));
  files.sort();

  return files.map((f) => {
    const content = readFileSync(join(resultsDir, f), 'utf-8');
    return JSON.parse(content) as BenchmarkResult;
  });
}

// ── Runner Orchestration ─────────────────────────────────────

/**
 * Run a single benchmark task.
 *
 * This creates two goals (with/without context) in the registry.
 * The actual LLM execution is delegated to `executeFn` — this allows
 * the runner to be used with different backends (Mitzo, Claude CLI, etc).
 *
 * @param executeFn - Called with (task, goalId, condition) to run the actual
 *   LLM session. Must report usage to the goal registry before returning.
 *   Returns true if the task succeeded.
 */
export async function runTask(
  config: RunnerConfig,
  task: TaskDefinition,
  executeFn: (
    task: TaskDefinition,
    goalId: string,
    condition: 'none' | 'compiled',
  ) => Promise<boolean>,
): Promise<BenchmarkResult> {
  // 1. Create goal for WITHOUT context run
  const goalWithout = await createGoal(config.registryBaseUrl, `[benchmark] ${task.title}`, {
    description: `Benchmark: ${task.prompt}`,
    successCriteria: task.successCriteria,
    contextCondition: 'none',
  });

  // 2. Execute without context
  const successWithout = await executeFn(task, goalWithout.id, 'none');
  if (successWithout) {
    await markGoalAchieved(config.registryBaseUrl, goalWithout.id);
  }

  // 3. Create goal for WITH context run
  const goalWith = await createGoal(config.registryBaseUrl, `[benchmark] ${task.title}`, {
    description: `Benchmark (with context): ${task.prompt}`,
    successCriteria: task.successCriteria,
    contextCondition: 'compiled',
  });

  // 4. Execute with compiled context
  const successWith = await executeFn(task, goalWith.id, 'compiled');
  if (successWith) {
    await markGoalAchieved(config.registryBaseUrl, goalWith.id);
  }

  // 5. Fetch results from registry
  const dataWithout = await getGoalWithContributions(config.registryBaseUrl, goalWithout.id);
  const dataWith = await getGoalWithContributions(config.registryBaseUrl, goalWith.id);

  const withoutCondition = extractRunCondition(dataWithout);
  const withCondition = extractRunCondition(dataWith);

  // 6. Compute delta and build result
  const result: BenchmarkResult = {
    taskId: task.id,
    timestamp: new Date().toISOString(),
    model: config.model,
    withoutContext: withoutCondition,
    withContext: withCondition,
    delta: computeDelta(withoutCondition, withCondition),
  };

  // 7. Save result
  saveResult(config.resultsDir, result);

  return result;
}

/**
 * Run all benchmark tasks sequentially.
 */
export async function runAllTasks(
  config: RunnerConfig,
  executeFn: (
    task: TaskDefinition,
    goalId: string,
    condition: 'none' | 'compiled',
  ) => Promise<boolean>,
): Promise<BenchmarkResult[]> {
  const tasks = loadTasks(config.tasksDir);
  const results: BenchmarkResult[] = [];

  for (const task of tasks) {
    const result = await runTask(config, task, executeFn);
    results.push(result);
  }

  return results;
}
