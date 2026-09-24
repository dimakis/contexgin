# Goal Tracking

The goals module tracks agent goals and associates them with token usage contributions for cost analysis. It answers the question: **how much did it cost to achieve this outcome, and did compiled context make a difference?**

## Concept

A goal represents a discrete outcome an agent is working toward. Each goal tracks:

- **What** -- title, description, success criteria
- **Status** -- active, achieved, failed, abandoned
- **Context condition** -- whether the agent had compiled context, partial context, or no context
- **Cost** -- token usage (input, output, cache), wall-clock time, API time, tool calls
- **Artifacts** -- linked PRs, commits, files, branches

By associating usage data with goals and their context conditions, you can compare the cost of achieving outcomes with and without context compilation.

## Data Model

```
Goal
├── id: string (UUID)
├── title: string
├── description: string | null
├── successCriteria: string[]
├── status: active | achieved | failed | abandoned
├── contextCondition: none | compiled | partial | unknown
├── bootPayloadTokens: number | null
├── createdAt: number (epoch ms)
├── achievedAt: number | null (epoch ms)
├── totals: GoalUsageTotals (aggregated from contributions)
│
├── contributions[]
│   ├── id: string (UUID)
│   ├── source: string (e.g., "claude-code", "mitzo")
│   ├── sourceId: string (e.g., session ID)
│   ├── sourceLabel: string | null
│   ├── inputTokens, outputTokens: number
│   ├── cacheReadTokens, cacheCreationTokens: number
│   ├── costUsd: number
│   ├── turns, toolCalls: number
│   ├── durationMs, durationApiMs: number
│   ├── metadata: object | null
│   └── timestamp: number (epoch ms)
│
└── artifacts[]
    ├── id: string (UUID)
    ├── type: string (pr, commit, file, branch, etc.)
    ├── ref: string (URL, SHA, path)
    ├── repo: string | null
    └── linkedAt: number (epoch ms)
```

### Context Conditions

| Condition  | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `none`     | Agent session had no compiled context                |
| `compiled` | Agent session received a full ContexGin boot payload |
| `partial`  | Agent had some context but not a full compilation    |
| `unknown`  | Context status is unknown                            |

### Usage Totals

`GoalUsageTotals` aggregates all contributions for a goal:

```typescript
interface GoalUsageTotals {
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
```

These totals are computed from the sum of all contributions. They update automatically when contributions are added.

## API Usage

### Create a Goal

```bash
curl -X POST http://127.0.0.1:4195/api/goals \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Fix payment retry logic",
    "description": "Retry backoff should be exponential, not linear",
    "successCriteria": ["Tests pass for exponential backoff", "PR merged"],
    "contextCondition": "compiled",
    "bootPayloadTokens": 8450
  }'
```

### List Goals

```bash
# All goals
curl http://127.0.0.1:4195/api/goals

# Only active goals
curl 'http://127.0.0.1:4195/api/goals?status=active'

# Achieved goals
curl 'http://127.0.0.1:4195/api/goals?status=achieved'
```

### Get Goal Details

```bash
# Returns goal + contributions + artifacts
curl http://127.0.0.1:4195/api/goals/<id>
```

### Record Usage

```bash
# Add a contribution from a Claude Code session
curl -X POST http://127.0.0.1:4195/api/goals/<id>/contributions \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "claude-code",
    "sourceId": "session-abc123",
    "sourceLabel": "Fix retry logic - attempt 2",
    "inputTokens": 15000,
    "outputTokens": 8000,
    "cacheReadTokens": 5000,
    "costUsd": 0.45,
    "turns": 12,
    "toolCalls": 35,
    "durationMs": 180000,
    "metadata": {"model": "claude-opus-4", "branch": "fix/retry-backoff"}
  }'
```

### Link Artifacts

```bash
# Link a PR
curl -X POST http://127.0.0.1:4195/api/goals/<id>/artifacts \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "pr",
    "ref": "https://github.com/dimakis/contexgin/pull/42",
    "repo": "dimakis/contexgin"
  }'

# Link a commit
curl -X POST http://127.0.0.1:4195/api/goals/<id>/artifacts \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "commit",
    "ref": "abc1234",
    "repo": "dimakis/contexgin"
  }'
```

### Mark Goal as Achieved

```bash
curl -X PATCH http://127.0.0.1:4195/api/goals/<id> \
  -H 'Content-Type: application/json' \
  -d '{"status": "achieved", "achievedAt": 1719849600000}'
```

## Library Usage

```typescript
import { GoalRegistry, GoalStore } from 'contexgin';

// Create a persistent store
const store = new GoalStore('/path/to/goals.db');
const registry = new GoalRegistry(store);

// Create a goal
const goal = registry.createGoal('Fix retry logic', {
  description: 'Exponential backoff needed',
  successCriteria: ['Tests pass', 'PR merged'],
  contextCondition: 'compiled',
  bootPayloadTokens: 8450,
});

// Record usage
registry.addContribution(goal.id, {
  source: 'claude-code',
  sourceId: 'session-abc',
  inputTokens: 15000,
  outputTokens: 8000,
  costUsd: 0.45,
  turns: 12,
});

// Link an artifact
registry.addArtifact(goal.id, {
  type: 'pr',
  ref: 'https://github.com/dimakis/contexgin/pull/42',
  repo: 'dimakis/contexgin',
});

// Mark achieved
registry.updateGoal(goal.id, {
  status: 'achieved',
  achievedAt: Date.now(),
});

// Query
const active = registry.listGoals({ status: 'active' });
const details = registry.getGoal(goal.id);
const contributions = registry.getContributions(goal.id);
```

## Persistence

The goal store uses SQLite with WAL mode for crash-safe persistence. Configure via the `--goals-db` CLI flag or `goalsDbPath` in server config:

```bash
# Persistent
npx contexgin serve ~/my-workspace --goals-db ~/.local/share/contexgin/goals.db

# In-memory (testing)
npx contexgin serve ~/my-workspace  # default: in-memory
```

## Use Case: Context Value Measurement

The primary use case for goal tracking is measuring whether compiled context reduces the cost of achieving outcomes.

### Methodology

1. Create goals for similar tasks across sessions
2. Tag some sessions with `contextCondition: "compiled"`, others with `"none"`
3. Record usage contributions for each session
4. Compare total tokens, cost, and time across conditions

### Expected Signal

A well-compiled context payload should reduce:

- **Total tokens** -- fewer tokens spent rediscovering what could have been stated
- **Turns** -- fewer back-and-forth exchanges to reach understanding
- **Tool calls** -- fewer exploratory reads/searches to orient

The goal tracking system provides the data; the analysis is up to you.
