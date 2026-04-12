// ── Goal Types ─────────────────────────────────────────────────

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  successCriteria: string[];
  status: GoalStatus;
  contextCondition: ContextCondition;
  bootPayloadTokens: number | null;
  createdAt: number;
  achievedAt: number | null;
  totals: GoalUsageTotals;
}

export type GoalStatus = 'active' | 'achieved' | 'failed' | 'abandoned';
export type ContextCondition = 'none' | 'compiled' | 'partial' | 'unknown';

export interface GoalUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  turns: number;
  toolCalls: number;
  durationMs: number;
  durationApiMs: number;
}

export interface UsageContribution {
  id: string;
  goalId: string;
  source: string;
  sourceId: string;
  sourceLabel: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  turns: number;
  toolCalls: number;
  durationMs: number;
  durationApiMs: number;
  metadata: Record<string, unknown> | null;
  timestamp: number;
}

export interface GoalArtifact {
  id: string;
  goalId: string;
  type: string;
  ref: string;
  repo: string | null;
  linkedAt: number;
}

// ── Input types (for create/update operations) ─────────────────

export interface CreateGoalOpts {
  description?: string;
  successCriteria?: string[];
  contextCondition?: ContextCondition;
  bootPayloadTokens?: number;
}

export interface UpdateGoalFields {
  title?: string;
  description?: string | null;
  successCriteria?: string[];
  status?: GoalStatus;
  contextCondition?: ContextCondition;
  bootPayloadTokens?: number | null;
  achievedAt?: number | null;
}

export interface AddContributionInput {
  source: string;
  sourceId: string;
  sourceLabel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  turns?: number;
  toolCalls?: number;
  durationMs?: number;
  durationApiMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AddArtifactInput {
  type: string;
  ref: string;
  repo?: string;
}

export interface ListGoalsOpts {
  status?: GoalStatus;
}

export interface UsageSummary {
  totalGoals: number;
  activeGoals: number;
  achievedGoals: number;
  totals: GoalUsageTotals;
}

export const EMPTY_TOTALS: GoalUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  turns: 0,
  toolCalls: 0,
  durationMs: 0,
  durationApiMs: 0,
};
