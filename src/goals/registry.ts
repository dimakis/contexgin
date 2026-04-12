import { randomUUID } from 'node:crypto';
import { GoalStore } from './store.js';
import type {
  Goal,
  GoalUsageTotals,
  UsageContribution,
  GoalArtifact,
  CreateGoalOpts,
  UpdateGoalFields,
  AddContributionInput,
  AddArtifactInput,
  ListGoalsOpts,
  UsageSummary,
} from './types.js';

// ── Row types (snake_case from SQLite) ────────────────────────

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  success_criteria: string | null;
  status: string;
  context_condition: string;
  boot_payload_tokens: number | null;
  created_at: number;
  achieved_at: number | null;
}

interface TotalsRow {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  turns: number;
  tool_calls: number;
  duration_ms: number;
  duration_api_ms: number;
}

interface ContributionRow {
  id: string;
  goal_id: string;
  source: string;
  source_id: string;
  source_label: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  turns: number;
  tool_calls: number;
  duration_ms: number;
  duration_api_ms: number;
  metadata: string | null;
  timestamp: number;
}

interface ArtifactRow {
  id: string;
  goal_id: string;
  type: string;
  ref: string;
  repo: string | null;
  linked_at: number;
}

// ── Registry ──────────────────────────────────────────────────

export class GoalRegistry {
  private store: GoalStore;

  constructor(dbPath: string) {
    this.store = new GoalStore(dbPath);
  }

  // ── Goals ─────────────────────────────────────────────────

  createGoal(title: string, opts?: CreateGoalOpts): Goal {
    const id = randomUUID();
    const now = Date.now() / 1000;
    const criteria = opts?.successCriteria ?? [];
    const contextCondition = opts?.contextCondition ?? 'unknown';

    this.store.db
      .prepare(
        `INSERT INTO goals (id, title, description, success_criteria, status, context_condition, boot_payload_tokens, created_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        title,
        opts?.description ?? null,
        criteria.length > 0 ? JSON.stringify(criteria) : null,
        contextCondition,
        opts?.bootPayloadTokens ?? null,
        now,
      );

    return this.getGoal(id)!;
  }

  getGoal(id: string): Goal | null {
    const row = this.store.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as
      | GoalRow
      | undefined;

    if (!row) return null;

    const totals = this.computeTotals(id);
    return this.rowToGoal(row, totals);
  }

  listGoals(opts?: ListGoalsOpts): Goal[] {
    let sql = 'SELECT * FROM goals';
    const params: unknown[] = [];

    if (opts?.status) {
      sql += ' WHERE status = ?';
      params.push(opts.status);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.store.db.prepare(sql).all(...params) as GoalRow[];
    return rows.map((row) => {
      const totals = this.computeTotals(row.id);
      return this.rowToGoal(row, totals);
    });
  }

  updateGoal(id: string, fields: UpdateGoalFields): Goal | null {
    const existing = this.store.db.prepare('SELECT id FROM goals WHERE id = ?').get(id) as
      | { id: string }
      | undefined;

    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.title !== undefined) {
      sets.push('title = ?');
      params.push(fields.title);
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      params.push(fields.description);
    }
    if (fields.successCriteria !== undefined) {
      sets.push('success_criteria = ?');
      params.push(
        fields.successCriteria.length > 0 ? JSON.stringify(fields.successCriteria) : null,
      );
    }
    if (fields.status !== undefined) {
      sets.push('status = ?');
      params.push(fields.status);
    }
    if (fields.contextCondition !== undefined) {
      sets.push('context_condition = ?');
      params.push(fields.contextCondition);
    }
    if (fields.bootPayloadTokens !== undefined) {
      sets.push('boot_payload_tokens = ?');
      params.push(fields.bootPayloadTokens);
    }
    if (fields.achievedAt !== undefined) {
      sets.push('achieved_at = ?');
      params.push(fields.achievedAt);
    }

    if (sets.length > 0) {
      params.push(id);
      this.store.db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }

    return this.getGoal(id);
  }

  deleteGoal(id: string): boolean {
    const result = this.store.db
      .prepare("UPDATE goals SET status = 'abandoned' WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // ── Contributions ─────────────────────────────────────────

  addContribution(goalId: string, input: AddContributionInput): UsageContribution {
    // Verify goal exists
    const goal = this.store.db.prepare('SELECT id FROM goals WHERE id = ?').get(goalId) as
      | { id: string }
      | undefined;

    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    const id = randomUUID();
    const now = Date.now() / 1000;

    this.store.db
      .prepare(
        `INSERT INTO contributions
         (id, goal_id, source, source_id, source_label,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, turns, tool_calls, duration_ms, duration_api_ms,
          metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        goalId,
        input.source,
        input.sourceId,
        input.sourceLabel ?? null,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
        input.cacheReadTokens ?? 0,
        input.cacheCreationTokens ?? 0,
        input.costUsd ?? 0,
        input.turns ?? 0,
        input.toolCalls ?? 0,
        input.durationMs ?? 0,
        input.durationApiMs ?? 0,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
      );

    return this.getContributions(goalId).find((c) => c.id === id)!;
  }

  getContributions(goalId: string): UsageContribution[] {
    const rows = this.store.db
      .prepare('SELECT * FROM contributions WHERE goal_id = ? ORDER BY timestamp ASC')
      .all(goalId) as ContributionRow[];

    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      source: row.source,
      sourceId: row.source_id,
      sourceLabel: row.source_label,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      costUsd: row.cost_usd,
      turns: row.turns,
      toolCalls: row.tool_calls,
      durationMs: row.duration_ms,
      durationApiMs: row.duration_api_ms,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
      timestamp: row.timestamp,
    }));
  }

  // ── Artifacts ─────────────────────────────────────────────

  addArtifact(goalId: string, input: AddArtifactInput): GoalArtifact {
    // Verify goal exists
    const goal = this.store.db.prepare('SELECT id FROM goals WHERE id = ?').get(goalId) as
      | { id: string }
      | undefined;

    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    const id = randomUUID();
    const now = Date.now() / 1000;

    this.store.db
      .prepare(
        `INSERT INTO artifacts (id, goal_id, type, ref, repo, linked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, goalId, input.type, input.ref, input.repo ?? null, now);

    return this.getArtifacts(goalId).find((a) => a.id === id)!;
  }

  getArtifacts(goalId: string): GoalArtifact[] {
    const rows = this.store.db
      .prepare('SELECT * FROM artifacts WHERE goal_id = ? ORDER BY linked_at ASC')
      .all(goalId) as ArtifactRow[];

    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      type: row.type,
      ref: row.ref,
      repo: row.repo,
      linkedAt: row.linked_at,
    }));
  }

  // ── Usage Summary ─────────────────────────────────────────

  getUsageSummary(): UsageSummary {
    const countRow = this.store.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active,
           COALESCE(SUM(CASE WHEN status = 'achieved' THEN 1 ELSE 0 END), 0) as achieved
         FROM goals`,
      )
      .get() as { total: number; active: number; achieved: number };

    const totalsRow = this.store.db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           COALESCE(SUM(turns), 0) as turns,
           COALESCE(SUM(tool_calls), 0) as tool_calls,
           COALESCE(SUM(duration_ms), 0) as duration_ms,
           COALESCE(SUM(duration_api_ms), 0) as duration_api_ms
         FROM contributions`,
      )
      .get() as TotalsRow;

    return {
      totalGoals: countRow.total,
      activeGoals: countRow.active,
      achievedGoals: countRow.achieved,
      totals: this.totalsRowToTotals(totalsRow),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────

  close(): void {
    this.store.close();
  }

  // ── Private helpers ───────────────────────────────────────

  private computeTotals(goalId: string): GoalUsageTotals {
    const row = this.store.db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           COALESCE(SUM(turns), 0) as turns,
           COALESCE(SUM(tool_calls), 0) as tool_calls,
           COALESCE(SUM(duration_ms), 0) as duration_ms,
           COALESCE(SUM(duration_api_ms), 0) as duration_api_ms
         FROM contributions WHERE goal_id = ?`,
      )
      .get(goalId) as TotalsRow;

    return this.totalsRowToTotals(row);
  }

  private totalsRowToTotals(row: TotalsRow): GoalUsageTotals {
    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      costUsd: row.cost_usd,
      turns: row.turns,
      toolCalls: row.tool_calls,
      durationMs: row.duration_ms,
      durationApiMs: row.duration_api_ms,
    };
  }

  private rowToGoal(row: GoalRow, totals: GoalUsageTotals): Goal {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      successCriteria: row.success_criteria ? (JSON.parse(row.success_criteria) as string[]) : [],
      status: row.status as Goal['status'],
      contextCondition: row.context_condition as Goal['contextCondition'],
      bootPayloadTokens: row.boot_payload_tokens,
      createdAt: row.created_at,
      achievedAt: row.achieved_at,
      totals,
    };
  }
}
