// ── Benchmark Task & Result Types ────────────────────────────

export interface TaskDefinition {
  id: string;
  title: string;
  prompt: string;
  difficulty: 'simple' | 'moderate' | 'complex';
  successCriteria: string[];
  workspace: string;
  expectedArtifacts: ExpectedArtifact[];
}

export interface ExpectedArtifact {
  type: 'file' | 'pr' | 'commit' | 'branch';
  pattern: string;
}

export interface RunCondition {
  goalId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  toolCalls: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  bootPayloadTokens?: number;
  compileCostUsd?: number;
}

export interface BenchmarkResult {
  taskId: string;
  timestamp: string;
  model: string;
  withoutContext: RunCondition;
  withContext: RunCondition;
  delta: BenchmarkDelta;
}

export interface BenchmarkDelta {
  tokenReduction: string;
  costReduction: string;
  turnReduction: string;
  toolCallReduction: string;
}

export interface RunnerConfig {
  registryBaseUrl: string;
  model: string;
  tasksDir: string;
  resultsDir: string;
}
