# ContexGin

Context infrastructure for the [Centaur](https://github.com/dimakis/centaur) agent ecosystem. Compiles, validates, and maintains structured context payloads that agents consume at boot and throughout their lifecycle.

ContexGin is opinionated — it's designed around the hub-spoke topology defined in the Centaur ecosystem. But the compiler works on any workspace with markdown context files (a `CONSTITUTION.md`, `CLAUDE.md`, or similar). You don't need spokes to get value from compilation, relevance ranking, and token budgeting. The hub-spoke model unlocks the full feature set — structural validation, cross-spoke boundaries, drift detection — but a flat project with a constitution file compiles just fine.

**Provider-agnostic** — context compilation is independent of which LLM runs the agent loop.

## The Hub-Spoke Model

ContexGin organises workspaces as a **hub-spoke topology**. This is the foundational pattern everything else builds on.

A **hub** is a workspace root — a directory with a `CONSTITUTION.md` at its root that declares its purpose, architecture, principles, and structural contract. A hub contains **spokes** — bounded sub-contexts, each with their own constitution, governance, and directory tree.

```
~/redhat/mgmt/                  ← Hub
├── CONSTITUTION.md              ← Declares the hub's structure
├── command_center/              ← Spoke: operational tooling
│   └── CONSTITUTION.md
├── architecture/                ← Spoke: design discussions
│   └── CONSTITUTION.md
├── memory/                      ← Spoke: persistent observations
│   └── CONSTITUTION.md
└── jira_process/                ← Spoke: data workspace
    └── CONSTITUTION.md
```

Why this topology:

- **Bounded contexts** — each spoke has its own governance. A PR review agent doesn't need access to career notes. Boundaries are declared, not implied.
- **Composable context** — the compiler pulls from specific hubs and spokes to assemble a payload. Different agents get different slices of the same workspace.
- **Structural validation** — constitutions declare what should exist. ContexGin checks whether reality matches. Drift is detected, not assumed away.
- **Cross-workspace federation** — multiple hubs connect through external references. A management hub can depend on a projects hub without either owning the other.

The hub-spoke model isn't a universal standard — it's a deliberate implementation choice for workspaces where structured context matters more than ad-hoc discovery.

## What ContexGin Does

Agent harnesses (Claude Code, Cursor, Codex CLI) solve tool calling and user experience — and those are genuinely hard problems. ContexGin doesn't replace any of that. It solves a complementary problem: **what context does the agent receive, and how do you keep it honest?**

A well-contexted agent session starts closer to understanding. It doesn't ask questions the workspace already answers, doesn't violate conventions it wasn't told about, doesn't waste tokens rediscovering what could have been stated. The gap between a bare session and a context-compiled session is immediately measurable in tokens spent to reach a correct result.

ContexGin automates the discipline: parse constitutions, rank sections by relevance, trim to a token budget, validate that declared structure matches reality, and serve it all over an API.

## Agent Definitions

Standard agent frameworks define agents as **tools + prompt**. Centaur defines agents as **tools + compiled context + governance + output conventions**. The difference is that context is not a flat prompt string — it's a structured compilation from hubs, spokes, profiles, and memory, assembled within a token budget.

An agent definition is a config file that describes what context an agent should receive. The schema is defined in the [Centaur repo](https://github.com/dimakis/centaur) under `schemas/agent/`. ContexGin does not consume these configs yet — this is the target integration point where the compiler will read agent definitions to assemble context payloads automatically.

```yaml
kind: AgentDefinition
version: '0.1'

identity:
  name: pr-reviewer
  description: Reviews PRs against architecture docs and writing guidelines
  mode: narrow # static context, single purpose

context:
  budget: 12000 # token ceiling
  sources:
    hubs:
      - path: ~/redhat/mgmt
        spokes: [architecture]
  priority:
    - architecture/discussions/**
  exclude:
    - memory/**
    - career/**

output:
  conventions:
    commit_style: conventional
  guides:
    - docs/review-criteria.md

governance:
  boundaries:
    - spoke: career
      access: none

memory:
  scope: none # narrow agents don't persist memory
```

Two modes from the same schema:

- **Narrow agents** — static context, single purpose. Every session compiles the same payload. A PR reviewer, a code auditor, a doc linter. The value is composability: define a config, point ContexGin at it, get a purpose-built agent.
- **Dynamic agents** — growing context over sessions. Memory scope is read-write, the vault accumulates observations and decisions, the compiler includes relevant vault content ranked by recency. A workspace assistant that learns over time.

**What's enforceable and what isn't**: Context selection (which hubs, spokes, budget) is fully enforceable — the compiler controls the payload. Governance boundaries are enforceable at both compiler level (won't include inaccessible content) and harness level (can reject tool calls). Output conventions (writing style, commit format) are injected as context instructions — a strong nudge, not a runtime guarantee. LLMs can drift past injected instructions. The schema acknowledges this enforcement gap rather than pretending it's solved.

## Install

```bash
npm install github:dimakis/contexgin
```

## Library Usage

### Compile context for a workspace

```typescript
import { compile } from 'contexgin';

const result = await compile({
  workspaceRoot: '/path/to/your/project',
  tokenBudget: 8000,
});

console.log(result.bootPayload); // Compiled system prompt
console.log(result.bootTokens); // Token count
console.log(result.navigationHints); // Suggested reading order
console.log(result.sources); // Which files contributed
console.log(result.trimmed); // What got cut for budget
```

### Auto-discover context sources

```typescript
import { discoverSources } from 'contexgin';

const sources = await discoverSources('/path/to/project');
// Finds: CONSTITUTION.md, CLAUDE.md, memory/Profile/*.md, SERVICES.md,
//        and spoke-level CONSTITUTION.md files
```

### Check for context drift

```typescript
import { extractClaims, validateAll } from 'contexgin';
import { readFileSync } from 'fs';

const content = readFileSync('CONSTITUTION.md', 'utf-8');
const claims = extractClaims(content, 'CONSTITUTION.md');
const report = await validateAll(claims, '/path/to/project');

console.log(`${report.summary.valid}/${report.summary.total} claims valid`);
for (const d of report.drift) {
  console.log(`  DRIFT: ${d.claim.assertion} — ${d.message}`);
}
```

### Index constitutions across repos

```typescript
import { indexConstitutions, generateReadingList } from 'contexgin';

const index = await indexConstitutions(['/path/to/repo-a', '/path/to/repo-b']);

const reading = generateReadingList('fix the payment retry logic', index);
for (const item of reading.items) {
  console.log(`${item.priority}. ${item.path} — ${item.reason}`);
}
```

## Modules

### Compiler

Parses markdown context sources into a heading tree, extracts sections, ranks by relevance, and trims to a token budget.

| Export                             | Description                                |
| ---------------------------------- | ------------------------------------------ |
| `compile(options)`                 | Main entry — returns `CompiledContext`     |
| `discoverSources(root)`            | Auto-discover context files in a workspace |
| `parseMarkdown(source)`            | Parse markdown into heading node tree      |
| `extractSection(nodes, path)`      | Extract section by heading path            |
| `rankSections(sections, options?)` | Rank by relevance tier                     |
| `trimToBudget(sections, budget)`   | Enforce token budget                       |
| `estimateTokens(text)`             | ~4 chars/token heuristic                   |

**Relevance tiers** (highest to lowest):

| Tier           | Weight | Examples                                        |
| -------------- | ------ | ----------------------------------------------- |
| Constitutional | 1.0    | Purpose, principles, boundaries                 |
| Navigational   | 0.8    | Architecture, directory semantics, entry points |
| Identity       | 0.7    | Profile, communication style                    |
| Reference      | 0.5    | Services, memory observations                   |
| Historical     | 0.3    | Session notes, old decisions                    |

### Integrity

Extracts testable claims from context files and validates them against the filesystem.

| Export                               | Description                         |
| ------------------------------------ | ----------------------------------- |
| `extractClaims(content, sourcePath)` | Extract claims from markdown        |
| `validateClaim(claim, root)`         | Validate one claim                  |
| `validateAll(claims, root)`          | Validate all, produce `DriftReport` |

**Claim types**: `file_exists`, `directory_exists`, `entry_point`, `boundary`, `structural`

### Graph

Builds a structural graph from parsed constitutions. Nodes are hubs and spokes; edges are dependencies, boundaries, and cross-hub references. The graph is the foundation for reference resolution (fixing cross-spoke false positives) and structural validation.

### Server (Daemon)

HTTP daemon built on Fastify. Holds the structural graph in memory, watches for constitution changes, and serves compilation and validation over a REST API.

### Navigation

Indexes constitutions across workspace roots and generates task-relevant reading lists.

| Export                                | Description                               |
| ------------------------------------- | ----------------------------------------- |
| `indexConstitutions(roots)`           | Index all CONSTITUTION.md files           |
| `generateReadingList(task, index)`    | Task-relevant reading list (max 10 items) |
| `isAccessAllowed(spoke, entry)`       | Check boundary access                     |
| `getAccessibleSpokes(entry, entries)` | List accessible spokes                    |
| `extractPurpose(content)`             | Extract purpose from constitution         |
| `extractEntryPoints(content)`         | Extract entry points                      |

## Key Types

```typescript
interface CompileOptions {
  workspaceRoot: string; // Workspace root directory
  tokenBudget: number; // Max tokens for boot payload
  sources?: ContextSource[]; // Override auto-discovery
  required?: string[][]; // Always-include section paths
  excluded?: string[][]; // Never-include section paths
  taskHint?: string; // Boost task-relevant sections
}

interface CompiledContext {
  bootPayload: string; // System prompt — injected at session start
  contextBlocks: Map<string, string>; // Deferred context keyed by spoke/topic
  navigationHints: string[]; // Reading order suggestions
  bootTokens: number; // Token count
  sources: ContextSource[]; // Contributing sources
  trimmed: ExtractedSection[]; // Dropped sections
}

interface DriftReport {
  timestamp: Date;
  workspaceRoot: string;
  results: ClaimResult[];
  drift: ClaimResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    byKind: Record<string, { total: number; invalid: number }>;
  };
}
```

### Boot vs Per-Turn Context

`bootPayload` is everything the agent gets at session start — compiled within the token budget. But not all relevant context belongs at boot. Sections that are important but didn't make the budget cut can be deferred as **context blocks** — injected mid-turn when the agent actually enters that area of the codebase.

The flow: agent reads a file → harness hook detects the spoke → fetches the context block from ContexGin → injects it as a system reminder. No boot tokens spent until the agent goes there.

`contextBlocks` is currently a placeholder (populated as an empty Map). Implementation is tracked in [#14](https://github.com/dimakis/contexgin/issues/14).

## Daemon

Contexgin runs as a long-lived HTTP daemon that serves the library's capabilities over a REST API. It watches your workspace for constitution changes and auto-rebuilds the structural graph.

### Quick Start

```bash
npm run build

# Start serving one or more workspace roots
npx contexgin serve ~/my-workspace --port 4195

# With SQLite persistence (survives restarts)
npx contexgin serve ~/my-workspace --db ~/.local/share/contexgin/graph.db

# Disable file watching
npx contexgin serve ~/my-workspace --no-watch
```

### API Endpoints

| Method | Path            | Description                                        |
| ------ | --------------- | -------------------------------------------------- |
| `GET`  | `/health`       | Status, hub/spoke count, violation summary, uptime |
| `POST` | `/compile`      | Compile context for a spoke                        |
| `POST` | `/validate`     | Full structural validation                         |
| `GET`  | `/graph`        | Full graph topology                                |
| `GET`  | `/graph/:hubId` | Single hub detail                                  |

### Examples

```bash
# Health check
curl http://127.0.0.1:4195/health

# Compile context for a spoke
curl -X POST http://127.0.0.1:4195/compile \
  -H 'Content-Type: application/json' \
  -d '{"spoke": "command_center", "task": "fix morning briefing", "budget": 8000}'

# Validate all workspaces
curl -X POST http://127.0.0.1:4195/validate \
  -H 'Content-Type: application/json' -d '{}'

# Get graph topology
curl http://127.0.0.1:4195/graph
```

Sample health response:

```json
{
  "status": "ok",
  "uptime": 3621,
  "hubs": 2,
  "spokes": 9,
  "violations": { "total": 1, "drift": 1, "missing": 0 }
}
```

### Production Deployment (launchd)

1. Create the start script at `scripts/start.sh`:

```bash
#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
cd /path/to/contexgin
exec node dist/cli.js serve \
  ~/my-workspace \
  --db ~/.local/share/contexgin/graph.db \
  --port 4195
```

2. Create a launchd plist at `~/Library/LaunchAgents/com.contexgin.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.contexgin.server</string>
    <key>ProgramArguments</key><array>
        <string>/bin/bash</string>
        <string>/path/to/contexgin/scripts/start.sh</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/path/to/contexgin/logs/stdout.log</string>
    <key>StandardErrorPath</key><string>/path/to/contexgin/logs/stderr.log</string>
</dict>
</plist>
```

3. Load and start:

```bash
mkdir -p ~/.local/share/contexgin logs
launchctl load ~/Library/LaunchAgents/com.contexgin.server.plist
curl http://127.0.0.1:4195/health  # verify
```

For integration examples (Claude Code hooks, Cursor rules, custom agent snippets), see [docs/integrations.md](docs/integrations.md).

## Context Files

Add to your project's `CLAUDE.md`:

```markdown
## Workspace Health

ContexGin daemon runs at http://127.0.0.1:4195. Before starting work:

- `curl http://127.0.0.1:4195/health` — check for structural errors
- `curl -X POST http://127.0.0.1:4195/compile -H 'Content-Type: application/json' -d '{"spoke":"<spoke>","task":"<your task>"}'` — get compiled context for the spoke you're working in
```

#### Cursor (.cursor/rules/)

Create `.cursor/rules/contexgin.mdc`:

```markdown
---
description: ContexGin workspace context
alwaysApply: false
globs: ['**/CONSTITUTION.md', '**/CLAUDE.md']
---

When editing constitution or context files, validate changes:
\`\`\`bash
curl -X POST http://127.0.0.1:4195/validate -H 'Content-Type: application/json' -d '{}'
\`\`\`

Check for structural drift before committing governance changes.
```

#### Mitzo / Custom Agents

```typescript
// Fetch compiled context for a task
const res = await fetch('http://127.0.0.1:4195/compile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    spoke: 'command_center',
    task: 'add new briefing type',
    budget: 6000,
  }),
});
const { context, tokens, sources } = await res.json();
// Inject `context` into your agent's system prompt
```

```typescript
// Monitor for drift in an agent loop
const health = await fetch('http://127.0.0.1:4195/health').then((r) => r.json());
if (health.violations.errors > 0) {
  console.warn(`Structural drift: ${health.violations.errors} errors`);
}
```

## Context Files

ContexGin discovers these files when scanning a workspace:

| File                  | Kind         | Description                                                    |
| --------------------- | ------------ | -------------------------------------------------------------- |
| `CONSTITUTION.md`     | constitution | Workspace/spoke governance and architecture                    |
| `CLAUDE.md`           | reference    | AI session instructions                                        |
| `SERVICES.md`         | service      | Service registry                                               |
| `memory/Profile/*.md` | profile      | User/workspace profile files                                   |
| `*/CONSTITUTION.md`   | constitution | Spoke-level constitutions                                      |
| `.centaurignore`      | ignore       | Exclude directories from graph traversal (`.gitignore` syntax) |

## Constitution Templates

See `examples/` for constitution templates:

- `hub-constitution.md` — Root workspace with sub-repo charters
- `spoke-constitution.md` — Leaf spoke with full sections
- `minimal-constitution.md` — Bare minimum to be valid

## Development

```bash
npm test           # Vitest — 235 tests across 23 files
npm run build      # tsup (ESM + declarations)
npm run lint       # ESLint + Prettier
npm run check      # TypeScript type check
```

TDD: tests first, implementation second. Conventional commits. Feature branches with PRs — never commit directly to main (enforced by pre-commit hook).

## License

Private — not yet published to npm.
