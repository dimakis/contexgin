# API Reference

Complete REST API reference for the ContexGin daemon. Default endpoint: `http://127.0.0.1:4195`.

## Health

### GET /health

Returns server status, graph statistics, and violation counts.

**Response:**

```json
{
  "status": "ok",
  "uptime": 3621.5,
  "hubs": 2,
  "spokes": 18,
  "lastBuild": "2026-06-15T10:30:00.000Z",
  "violations": {
    "errors": 0,
    "warnings": 1,
    "info": 3
  }
}
```

| Field        | Type                 | Description                            |
| ------------ | -------------------- | -------------------------------------- |
| `status`     | `"ok" \| "building"` | `"building"` during graph rebuild      |
| `uptime`     | `number`             | Seconds since daemon start             |
| `hubs`       | `number`             | Number of workspace hubs               |
| `spokes`     | `number`             | Total spokes across all hubs           |
| `lastBuild`  | `string \| null`     | ISO 8601 timestamp of last graph build |
| `violations` | `object`             | Violation counts by severity           |

## Compile

### POST /compile

Compile context for a spoke within a workspace.

**Request:**

```json
{
  "spoke": "command_center",
  "task": "fix morning briefing calendar parsing",
  "budget": 12000
}
```

| Field    | Type     | Required | Default | Description                             |
| -------- | -------- | -------- | ------- | --------------------------------------- |
| `spoke`  | `string` | Yes      | --      | Spoke path, name, or ID                 |
| `task`   | `string` | No       | --      | Task description for relevance boosting |
| `budget` | `number` | No       | `12000` | Token budget ceiling                    |

**Response:**

```json
{
  "context": "## Governance\n...\n## Architecture\n...\n## Conventions\n...",
  "tokens": 8450,
  "sources": 6,
  "spoke": "mgmt/command_center",
  "nodes": [
    {
      "id": "git-discipline",
      "type": "operational",
      "tier": "navigational",
      "content": "All commits use conventional format...",
      "tokenEstimate": 120,
      "origin": {
        "source": "/path/to/CLAUDE.md",
        "relativePath": "CLAUDE.md",
        "format": "claude_md",
        "headingPath": ["Git Discipline"]
      }
    }
  ]
}
```

| Field     | Type               | Description                             |
| --------- | ------------------ | --------------------------------------- |
| `context` | `string`           | Compiled boot payload (grouped by type) |
| `tokens`  | `number`           | Token count of the payload              |
| `sources` | `number`           | Number of source files that contributed |
| `spoke`   | `string`           | Resolved spoke ID                       |
| `nodes`   | `SerializedNode[]` | Typed context nodes (optional)          |

**Errors:**

| Status | Condition                |
| ------ | ------------------------ |
| 400    | Missing `spoke` field    |
| 404    | Spoke not found in graph |
| 500    | Compilation failed       |
| 503    | Graph not built yet      |

## Validate

### POST /validate

Run structural and relational validation across workspace roots. Includes doc-consistency validation (checks that documentation claims match reality).

**Request:**

```json
{
  "roots": ["~/redhat/mgmt"]
}
```

| Field   | Type       | Required | Default      | Description                 |
| ------- | ---------- | -------- | ------------ | --------------------------- |
| `roots` | `string[]` | No       | Server roots | Workspace roots to validate |

**Response:**

```json
{
  "violations": [
    {
      "kind": "undeclared_directory",
      "severity": "warning",
      "location": "mgmt/experiments",
      "declared": null,
      "actual": "directory exists",
      "source": "/path/to/CONSTITUTION.md",
      "message": "Directory exists but is not declared in constitution",
      "suggestion": "Add to spoke declarations or .centaurignore"
    }
  ],
  "summary": {
    "errors": 0,
    "warnings": 1,
    "info": 0,
    "hubs": 1,
    "spokes": 18
  }
}
```

**Violation kinds:**

| Kind                   | Severity | Description                                |
| ---------------------- | -------- | ------------------------------------------ |
| `missing_directory`    | error    | Declared directory does not exist          |
| `missing_file`         | error    | Declared file does not exist               |
| `undeclared_directory` | warning  | Directory exists but is not declared       |
| `missing_constitution` | warning  | Spoke has no CONSTITUTION.md               |
| `stale_reference`      | warning  | Documentation claim does not match reality |
| `broken_dependency`    | error    | Dependency target does not exist           |
| `missing_external`     | error    | External hub reference not found           |
| `boundary_violation`   | error    | Conflicting boundary declarations          |
| `nesting_depth`        | warning  | Spoke nesting exceeds depth limit (2)      |

**Errors:**

| Status | Condition                       |
| ------ | ------------------------------- |
| 400    | No roots configured or provided |

## Graph

### GET /graph

Returns the full hub-spoke topology.

**Response:**

```json
{
  "hubs": [
    {
      "id": "mgmt",
      "name": "mgmt",
      "path": "/Users/user/redhat/mgmt",
      "purpose": "Root workspace for management practice",
      "spokes": [
        {
          "id": "mgmt/command_center",
          "name": "command_center",
          "path": "/Users/user/redhat/mgmt/command_center",
          "confidentiality": "none",
          "hasConstitution": true
        }
      ],
      "externals": [
        {
          "path": "~/redhat/team_home",
          "description": "Team Jira codebase"
        }
      ]
    }
  ],
  "edges": [
    {
      "from": "mgmt/jira_process",
      "to": "mgmt/command_center",
      "kind": "reads_from",
      "description": "Reads parquet data for briefings"
    }
  ],
  "violations": 1
}
```

**Errors:**

| Status | Condition           |
| ------ | ------------------- |
| 503    | Graph not built yet |

### GET /graph/:hubId

Returns a single hub's subgraph, including only edges that touch that hub.

**Parameters:**

| Parameter | Description    |
| --------- | -------------- |
| `hubId`   | Hub ID or name |

**Response:** Same shape as `GET /graph` but filtered to one hub.

**Errors:**

| Status | Condition           |
| ------ | ------------------- |
| 404    | Hub not found       |
| 503    | Graph not built yet |

## Agents

### GET /api/agents

List all discovered agent definitions across workspace roots. Definitions are discovered from `.agents/*.yaml` files in each root.

**Response:**

```json
{
  "agents": [
    {
      "name": "pr-reviewer",
      "filePath": "/Users/user/redhat/mgmt/.agents/pr-reviewer.yaml",
      "workspaceRoot": "/Users/user/redhat/mgmt"
    },
    {
      "name": "workspace-assistant",
      "filePath": "/Users/user/redhat/mgmt/.agents/workspace-assistant.yaml",
      "workspaceRoot": "/Users/user/redhat/mgmt"
    }
  ]
}
```

Agent discovery results are cached for 30 seconds.

### GET /api/agents/:name/context

Compile boot context for a named agent using its definition. Optionally override workspace root and/or provide session origin metadata.

**Parameters:**

| Parameter | Description           |
| --------- | --------------------- |
| `name`    | Agent definition name |

**Query parameters:**

| Parameter         | Type     | Required | Description                                            |
| ----------------- | -------- | -------- | ------------------------------------------------------ |
| `workspace`       | `string` | No       | Override workspace root (must be within allowed roots) |
| `origin.source`   | `string` | No       | Session origin: `chat`, `telos`, `calendar`, `file`    |
| `origin.entityId` | `string` | No       | Entity ID for the origin (e.g., Telos item ID)         |

**Response:**

```json
{
  "agent": "pr-reviewer",
  "identity": {
    "name": "pr-reviewer",
    "description": "Reviews PRs against architecture docs",
    "role": "code-reviewer"
  },
  "boot": {
    "content": "## Governance\n...\n## Architecture\n...",
    "tokens": 6200,
    "tokenBudget": 12000,
    "sources": ["/path/to/CONSTITUTION.md", "/path/to/CLAUDE.md"]
  },
  "contextBlocks": {},
  "operational": {
    "files": [
      {
        "path": "docs/review-criteria.md",
        "content": "..."
      }
    ],
    "delivery": "additionalContext"
  },
  "governance": {
    "forbidden": ["Merge PRs without two reviews"],
    "required": ["Check CI status before approving"],
    "approvalRequired": ["Force-push to any branch"]
  },
  "skills": [],
  "provider": {
    "provider": "anthropic",
    "model": "claude-opus-4",
    "temperature": 0.3
  }
}
```

| Field              | Type                  | Description                              |
| ------------------ | --------------------- | ---------------------------------------- |
| `agent`            | `string`              | Agent name                               |
| `identity`         | `object`              | Agent identity (name, description, role) |
| `boot.content`     | `string`              | Compiled boot payload                    |
| `boot.tokens`      | `number`              | Token count                              |
| `boot.tokenBudget` | `number`              | Token budget from definition             |
| `boot.sources`     | `string[]`            | Source files included                    |
| `contextBlocks`    | `object`              | Deferred context blocks (keyed by ID)    |
| `operational`      | `object \| undefined` | Always-on files and delivery mechanism   |
| `memory`           | `object \| undefined` | Memory context by type                   |
| `governance`       | `object \| undefined` | Governance rules                         |
| `skills`           | `array`               | Enabled skills                           |
| `provider`         | `object`              | Provider configuration                   |

**Errors:**

| Status | Condition                                            |
| ------ | ---------------------------------------------------- |
| 400    | Invalid `origin.source` value                        |
| 403    | Workspace path not within allowed roots              |
| 404    | Agent not found (response includes `available` list) |
| 500    | Compilation failed                                   |

**Examples:**

```bash
# Basic compilation
curl 'http://127.0.0.1:4195/api/agents/pr-reviewer/context'

# With workspace override
curl 'http://127.0.0.1:4195/api/agents/pr-reviewer/context?workspace=/Users/user/projects/other'

# With Telos origin
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=telos&origin.entityId=abc123'

# With file origin
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=file&origin.entityId=src/server/app.ts'
```

## Goals

Track agent goals with token usage contributions and linked artifacts. See [goals.md](goals.md) for the conceptual overview.

### POST /api/goals

Create a new goal.

**Request:**

```json
{
  "title": "Fix payment retry logic",
  "description": "The retry backoff is not exponential",
  "successCriteria": ["Tests pass for exponential backoff", "PR merged"],
  "contextCondition": "compiled",
  "bootPayloadTokens": 8450
}
```

| Field               | Type       | Required | Description                              |
| ------------------- | ---------- | -------- | ---------------------------------------- |
| `title`             | `string`   | Yes      | Goal title                               |
| `description`       | `string`   | No       | Detailed description                     |
| `successCriteria`   | `string[]` | No       | List of success criteria                 |
| `contextCondition`  | `string`   | No       | `none`, `compiled`, `partial`, `unknown` |
| `bootPayloadTokens` | `number`   | No       | Token count of the boot payload used     |

**Response:** `201 Created` with the created Goal object.

### GET /api/goals

List all goals, optionally filtered by status.

**Query parameters:**

| Parameter | Type     | Description                                         |
| --------- | -------- | --------------------------------------------------- |
| `status`  | `string` | Filter: `active`, `achieved`, `failed`, `abandoned` |

**Response:** Array of Goal objects.

### GET /api/goals/:id

Get a single goal with its contributions and artifacts.

**Response:**

```json
{
  "goal": { ... },
  "contributions": [ ... ],
  "artifacts": [ ... ]
}
```

### PATCH /api/goals/:id

Update a goal's fields.

**Request:**

```json
{
  "status": "achieved",
  "achievedAt": 1719849600000
}
```

All fields are optional. Updatable fields: `title`, `description`, `successCriteria`, `status`, `contextCondition`, `bootPayloadTokens`, `achievedAt`.

**Response:** Updated Goal object.

### DELETE /api/goals/:id

Delete a goal and all its contributions and artifacts.

**Response:** `{ "ok": true }`

### POST /api/goals/:id/contributions

Add a token usage contribution to a goal.

**Request:**

```json
{
  "source": "claude-code",
  "sourceId": "session-abc123",
  "sourceLabel": "Fix retry logic session",
  "inputTokens": 15000,
  "outputTokens": 8000,
  "cacheReadTokens": 5000,
  "cacheCreationTokens": 2000,
  "costUsd": 0.45,
  "turns": 12,
  "toolCalls": 35,
  "durationMs": 180000,
  "durationApiMs": 45000,
  "metadata": {
    "model": "claude-opus-4",
    "branch": "fix/retry-backoff"
  }
}
```

| Field                 | Type     | Required | Description                                            |
| --------------------- | -------- | -------- | ------------------------------------------------------ |
| `source`              | `string` | Yes      | Source system (e.g., `claude-code`, `cursor`, `mitzo`) |
| `sourceId`            | `string` | Yes      | Unique ID within the source                            |
| `sourceLabel`         | `string` | No       | Human-readable label                                   |
| `inputTokens`         | `number` | No       | Input tokens consumed                                  |
| `outputTokens`        | `number` | No       | Output tokens generated                                |
| `cacheReadTokens`     | `number` | No       | Cache read tokens                                      |
| `cacheCreationTokens` | `number` | No       | Cache creation tokens                                  |
| `costUsd`             | `number` | No       | Estimated cost in USD                                  |
| `turns`               | `number` | No       | Number of conversation turns                           |
| `toolCalls`           | `number` | No       | Number of tool calls                                   |
| `durationMs`          | `number` | No       | Wall-clock duration in ms                              |
| `durationApiMs`       | `number` | No       | API call duration in ms                                |
| `metadata`            | `object` | No       | Arbitrary metadata                                     |

**Response:** `201 Created` with the created Contribution object.

### GET /api/goals/:id/contributions

List all contributions for a goal.

**Response:** Array of Contribution objects.

### POST /api/goals/:id/artifacts

Link an artifact (PR, commit, file) to a goal.

**Request:**

```json
{
  "type": "pr",
  "ref": "https://github.com/dimakis/contexgin/pull/42",
  "repo": "dimakis/contexgin"
}
```

| Field  | Type     | Required | Description                                            |
| ------ | -------- | -------- | ------------------------------------------------------ |
| `type` | `string` | Yes      | Artifact type (e.g., `pr`, `commit`, `file`, `branch`) |
| `ref`  | `string` | Yes      | Reference (URL, SHA, path)                             |
| `repo` | `string` | No       | Repository identifier                                  |

**Response:** `201 Created` with the created Artifact object.

### GET /api/goals/:id/artifacts

List all artifacts for a goal.

**Response:** Array of Artifact objects.

## Common Error Shape

All error responses follow the same shape:

```json
{
  "error": "Human-readable error message"
}
```

Some errors include additional fields:

```json
{
  "error": "Agent not found: foo",
  "available": ["pr-reviewer", "workspace-assistant"]
}
```

```json
{
  "error": "Invalid origin.source: bogus",
  "valid": ["chat", "telos", "calendar", "file"]
}
```
