# ContexGin

Context infrastructure for AI agent ecosystems. Compiles, validates, and serves structured context payloads that agents consume at boot and throughout their lifecycle.

ContexGin is opinionated -- it's designed around a hub-spoke topology where workspaces declare their own structure via constitution files. But the compiler works on any project with markdown context files (a `CONSTITUTION.md`, `CLAUDE.md`, or similar). You don't need spokes to get value from compilation, relevance ranking, and token budgeting. The hub-spoke model unlocks the full feature set -- structural validation, cross-spoke boundaries, drift detection -- but a flat project with a constitution file compiles just fine.

**Provider-agnostic** -- context compilation is independent of which LLM runs the agent loop.

## The Hub-Spoke Model

ContexGin organises workspaces as a **hub-spoke topology**. This is the foundational pattern everything else builds on.

A **hub** is a workspace root -- a directory with a `CONSTITUTION.md` at its root that declares its purpose, architecture, principles, and structural contract. A hub contains **spokes** -- bounded sub-contexts, each with their own constitution, governance, and directory tree.

```
~/redhat/mgmt/                  <- Hub
├── CONSTITUTION.md              <- Declares the hub's structure
├── command_center/              <- Spoke: operational tooling
│   └── CONSTITUTION.md
├── architecture/                <- Spoke: design discussions
│   └── CONSTITUTION.md
├── memory/                      <- Spoke: persistent observations
│   └── CONSTITUTION.md
└── jira_process/                <- Spoke: data workspace
    └── CONSTITUTION.md
```

Why this topology:

- **Bounded contexts** -- each spoke has its own governance. A PR review agent doesn't need access to career notes. Boundaries are declared, not implied.
- **Composable context** -- the compiler pulls from specific hubs and spokes to assemble a payload. Different agents get different slices of the same workspace.
- **Structural validation** -- constitutions declare what should exist. ContexGin checks whether reality matches. Drift is detected, not assumed away.
- **Cross-workspace federation** -- multiple hubs connect through external references. A management hub can depend on a projects hub without either owning the other.

## What ContexGin Does

Agent harnesses (Claude Code, Cursor, Codex CLI) solve tool calling and user experience -- genuinely hard problems. ContexGin doesn't replace any of that. It solves a complementary problem: **what context does the agent receive, and how do you keep it honest?**

A well-contexted agent session starts closer to understanding. It doesn't ask questions the workspace already answers, doesn't violate conventions it wasn't told about, doesn't waste tokens rediscovering what could have been stated. The gap between a bare session and a context-compiled session is immediately measurable in tokens spent to reach a correct result.

ContexGin automates the discipline: parse context sources via format-aware adapters, normalize into typed context nodes, rank by relevance, trim to a token budget, validate that declared structure matches reality, and serve it all over an API.

## Architecture Overview

ContexGin is organized into modules, each handling a distinct concern:

| Module          | Purpose                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| **Compiler**    | Parse markdown, rank by relevance, trim to token budget, assemble payloads                                   |
| **Adapter**     | Normalize heterogeneous context formats (CLAUDE.md, .cursor/rules, CONSTITUTION.md) into typed context nodes |
| **Graph**       | Build structural graph from constitutions -- hubs, spokes, edges, boundaries                                 |
| **Integrity**   | Extract testable claims from context files, validate against filesystem                                      |
| **Navigation**  | Index constitutions across repos, generate task-relevant reading lists                                       |
| **Recipe**      | Declarative agent definitions -- compile context per agent from YAML configs                                 |
| **Resolve**     | Determine context based on session origin (chat, Telos task, calendar event, file)                           |
| **Goals**       | Track agent goals with token usage contributions for cost analysis                                           |
| **Server**      | Fastify HTTP daemon -- serves all capabilities over REST API                                                 |
| **Provider**    | Adapter interfaces for LLM providers (types only, no implementations)                                        |
| **Permissions** | Unified permission engine across providers and tools                                                         |
| **Tools**       | Tool registry for direct function calls and MCP bridge                                                       |
| **Registry**    | Schema validation and drift detection for workspace declarations                                             |
| **Benchmarks**  | Task-based benchmarking for tokens-to-goal measurement                                                       |

For a deep dive into module interactions and data flow, see [docs/architecture.md](docs/architecture.md).

## Install

```bash
npm install github:dimakis/contexgin
```

## Quick Start

### As a Library

```typescript
import { compile } from 'contexgin';

const result = await compile({
  workspaceRoot: '/path/to/your/project',
  tokenBudget: 12000,
});

console.log(result.bootPayload); // Compiled system prompt
console.log(result.bootTokens); // Token count
console.log(result.navigationHints); // Suggested reading order
console.log(result.sources); // Which files contributed
console.log(result.trimmed); // What got cut for budget
console.log(result.nodes); // Typed context nodes
```

### As a Daemon

```bash
npm run build

# Start serving one or more workspace roots
npx contexgin serve ~/my-workspace --port 4195

# With SQLite persistence (survives restarts)
npx contexgin serve ~/my-workspace --db ~/.local/share/contexgin/graph.db

# With goal tracking persistence
npx contexgin serve ~/my-workspace \
  --db ~/.local/share/contexgin/graph.db \
  --goals-db ~/.local/share/contexgin/goals.db

# With agent definitions
npx contexgin serve ~/my-workspace --agent-defs ~/.agents

# Disable file watching
npx contexgin serve ~/my-workspace --no-watch
```

## CLI

```
contexgin -- structural graph engine for workspaces

Commands:
  validate <root> [root2] ...   Validate workspace structure
  graph <root> [root2] ...      Print graph summary
  serve <root> [root2] ...      Start daemon with HTTP API

Serve options:
  --port N            TCP port (default: 4195)
  --socket PATH       Unix socket path
  --no-watch          Disable file watching
  --db PATH           SQLite database path (default: in-memory)
  --goals-db PATH     Goals SQLite database path (default: in-memory)
  --agent-defs PATH   Agent definition search path (repeatable)
```

### Validate a Workspace

```bash
$ npx contexgin validate ~/redhat/mgmt

Building graph...
Validating...

/Users/dsaridak/redhat/mgmt (18 spokes, 5 edges)

  command_center/  ✓ clean
  architecture/    ✓ clean
  memory/          ✓ clean
  career/  [hard]  ✓ clean
  ...

✓ 18 spokes validated -- no issues
```

### Print Graph Summary

```bash
$ npx contexgin graph ~/redhat/mgmt

Hub: mgmt
  Path: /Users/dsaridak/redhat/mgmt
  Purpose: Root workspace for management practice
  Spokes: 18

  command_center/  ✓
    Personal command center...
  architecture/  ✓
    Architecture intelligence...
  career/ [hard]  ✓
    Career strategy...
```

## API Reference

The daemon serves a REST API on `http://127.0.0.1:4195` (configurable). For the complete API reference with request/response schemas and examples, see [docs/api-reference.md](docs/api-reference.md).

### Endpoint Summary

| Method   | Path                           | Description                                        |
| -------- | ------------------------------ | -------------------------------------------------- |
| `GET`    | `/health`                      | Status, hub/spoke count, violation summary, uptime |
| `POST`   | `/compile`                     | Compile context for a spoke                        |
| `POST`   | `/validate`                    | Full structural validation                         |
| `GET`    | `/graph`                       | Full graph topology                                |
| `GET`    | `/graph/:hubId`                | Single hub detail                                  |
| `GET`    | `/api/agents`                  | List discovered agent definitions                  |
| `GET`    | `/api/agents/:name/context`    | Compile boot context for a named agent             |
| `POST`   | `/api/goals`                   | Create a goal                                      |
| `GET`    | `/api/goals`                   | List goals (filterable by status)                  |
| `GET`    | `/api/goals/:id`               | Get goal with contributions and artifacts          |
| `PATCH`  | `/api/goals/:id`               | Update a goal                                      |
| `DELETE` | `/api/goals/:id`               | Delete a goal                                      |
| `POST`   | `/api/goals/:id/contributions` | Add token usage contribution                       |
| `GET`    | `/api/goals/:id/contributions` | List contributions for a goal                      |
| `POST`   | `/api/goals/:id/artifacts`     | Link an artifact (PR, commit) to a goal            |
| `GET`    | `/api/goals/:id/artifacts`     | List artifacts for a goal                          |

### Quick Examples

```bash
# Health check
curl http://127.0.0.1:4195/health

# Compile context for a spoke
curl -X POST http://127.0.0.1:4195/compile \
  -H 'Content-Type: application/json' \
  -d '{"spoke": "command_center", "task": "fix morning briefing", "budget": 12000}'

# Validate all workspaces
curl -X POST http://127.0.0.1:4195/validate \
  -H 'Content-Type: application/json' -d '{}'

# Get graph topology
curl http://127.0.0.1:4195/graph

# List available agents
curl http://127.0.0.1:4195/api/agents

# Get compiled context for an agent
curl 'http://127.0.0.1:4195/api/agents/pr-reviewer/context'

# Get agent context with origin (Telos task)
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=telos&origin.entityId=abc123'
```

## Library API

### Compiler

Parses markdown context sources into a heading tree, extracts sections, ranks by relevance, and trims to a token budget.

| Export                             | Description                                |
| ---------------------------------- | ------------------------------------------ |
| `compile(options)`                 | Main entry -- returns `CompiledContext`    |
| `discoverSources(root)`            | Auto-discover context files in a workspace |
| `parseMarkdown(source)`            | Parse markdown into heading node tree      |
| `extractSection(nodes, path)`      | Extract section by heading path            |
| `extractAllLevel2(nodes)`          | Extract all level-2 sections               |
| `rankSections(sections, options?)` | Rank by relevance tier                     |
| `trimToBudget(sections, budget)`   | Enforce token budget with deduplication    |
| `estimateTokens(text)`             | ~4 chars/token heuristic                   |
| `stripFrontmatter(text)`           | Remove YAML frontmatter from markdown      |
| `cleanContent(text)`               | Normalize whitespace in markdown           |

**Relevance tiers** (highest to lowest):

| Tier           | Weight | Examples                                         |
| -------------- | ------ | ------------------------------------------------ |
| Constitutional | 1.0    | Purpose, principles, boundaries                  |
| Navigational   | 0.8    | Architecture, directory semantics, entry points  |
| Operational    | 0.75   | Git workflows, CLI commands, worktree operations |
| Identity       | 0.7    | Profile, communication style                     |
| Reference      | 0.5    | Services, memory observations                    |
| Historical     | 0.3    | Session notes, old decisions                     |

Spoke-level content receives a 0.35 relevance penalty (context, not instructions). Task hints boost matching sections by up to +0.2.

### Adapter

Normalizes heterogeneous context sources into typed context nodes. Each adapter handles a specific format.

| Export                      | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `discoverAndAdapt(root)`    | Auto-discover files and adapt all via matching adapters |
| `findAdapter(filePath)`     | Find the adapter that can handle a given file           |
| `adaptFile(filePath, root)` | Adapt a single file into context nodes                  |
| `claudeAdapter`             | Adapter for CLAUDE.md files                             |
| `cursorAdapter`             | Adapter for .cursor/rules/\*.mdc files                  |
| `constitutionAdapter`       | Adapter for CONSTITUTION.md files                       |
| `markdownAdapter`           | Fallback adapter for README.md and generic markdown     |

See [docs/architecture.md](docs/architecture.md) for the full adapter pipeline and context node model.

### Graph

Builds a structural graph from parsed constitutions. Nodes are hubs and spokes; edges are dependencies, boundaries, and cross-hub references.

| Export                                        | Description                                         |
| --------------------------------------------- | --------------------------------------------------- |
| `buildGraph(roots)`                           | Build complete hub-spoke graph from workspace roots |
| `parseConstitution(filePath)`                 | Parse a single CONSTITUTION.md into typed structure |
| `parseConstitutionContent(content, filePath)` | Parse constitution from string content              |
| `validateGraph(graph)`                        | Run structural + relational validation              |
| `findSpoke(graph, query)`                     | Find a spoke by name, path, or ID                   |
| `resolveReference(graph, ref)`                | Resolve a cross-spoke reference                     |
| `traverseDependencies(graph, id)`             | Walk the dependency graph                           |
| `isAccessible(graph, from, to)`               | Check boundary access between spokes                |
| `getExternals(graph)`                         | Get all external hub references                     |
| `loadIgnorePatterns(root)`                    | Load .centaurignore patterns                        |
| `shouldIgnore(path, patterns)`                | Check if path matches ignore patterns               |

**Violation kinds**: `missing_directory`, `missing_file`, `undeclared_directory`, `missing_constitution`, `stale_reference`, `broken_dependency`, `missing_external`, `boundary_violation`, `nesting_depth`

**Violation severities**: `error`, `warning`, `info`

### Integrity

Extracts testable claims from context files and validates them against the filesystem.

| Export                                           | Description                           |
| ------------------------------------------------ | ------------------------------------- |
| `extractClaims(content, sourcePath)`             | Extract claims from markdown          |
| `extractTreeStructureClaim(content, sourcePath)` | Extract tree structure claims         |
| `validateClaim(claim, root)`                     | Validate one claim                    |
| `validateAll(claims, root)`                      | Validate all, produce `DriftReport`   |
| `parseAsciiTree(text)`                           | Parse ASCII tree diagrams             |
| `buildDeclaredTree(claims)`                      | Build declared tree from claims       |
| `walkFilesystem(root)`                           | Walk actual filesystem for comparison |
| `diffTrees(declared, actual)`                    | Compare declared vs actual structure  |
| `validateFederated(roots)`                       | Multi-hub federated validation        |

**Claim types**: `file_exists`, `directory_exists`, `entry_point`, `boundary`, `structural`

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
| `extractDirectorySemantics(content)`  | Extract directory semantics               |

### Recipe (Agent Definitions)

Declarative agent definitions for multi-client context serving. See [docs/agent-definitions.md](docs/agent-definitions.md) for the full guide.

| Export                             | Description                                      |
| ---------------------------------- | ------------------------------------------------ |
| `loadAgentDefinition(filePath)`    | Load and validate a single agent definition YAML |
| `loadAgentDefinitions()`           | Load all definitions from standard paths         |
| `validateAgentDefinition(def)`     | Validate an agent definition object              |
| `compileAgent(def, root, origin?)` | Compile boot context for an agent definition     |

### Origin Resolution

Determines what context to inject based on how a session was triggered. See [docs/origin-resolution.md](docs/origin-resolution.md).

| Export                                  | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| `resolveOrigin(origin, root, defaults)` | Resolve origin to a context manifest           |
| `findResolver(source)`                  | Find resolver for an origin source             |
| `chatResolver`                          | Default resolver for interactive chat sessions |
| `telosResolver`                         | Resolver for Telos task-triggered sessions     |
| `calendarResolver`                      | Resolver for calendar event-triggered sessions |
| `fileResolver`                          | Resolver for file-scoped sessions              |

**Origin sources**: `chat`, `telos`, `calendar`, `file`

### Goals

Track agent goals and associate them with token usage contributions. See [docs/goals.md](docs/goals.md).

| Export         | Description                              |
| -------------- | ---------------------------------------- |
| `GoalRegistry` | In-memory goal registry backed by SQLite |
| `GoalStore`    | SQLite persistence layer for goals       |
| `goalRoutes`   | Fastify route registration for goal API  |

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
  bootPayload: string; // System prompt
  contextBlocks: Map<string, string>; // Deferred context keyed by spoke/topic
  navigationHints: string[]; // Reading order suggestions
  bootTokens: number; // Token count
  sources: ContextSource[]; // Contributing sources
  trimmed: ExtractedSection[]; // Dropped sections
  nodes?: SerializedNode[]; // Typed context nodes (adapter pipeline)
  includedSections?: ExtractedSection[]; // Sections included in payload
}

interface ContextNode {
  id: string; // Unique ID within source
  type: ContextNodeType; // structural | operational | identity | governance | reference
  tier: ContextTier; // constitutional | navigational | identity | reference | historical
  content: string; // The actual context text
  origin: NodeOrigin; // Where this came from (source, format, heading path)
  tokenEstimate: number; // Approximate token count
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

`bootPayload` is everything the agent gets at session start -- compiled within the token budget. But not all relevant context belongs at boot. Sections that are important but didn't make the budget cut can be deferred as **context blocks** -- injected mid-turn when the agent actually enters that area of the codebase.

The flow: agent reads a file -> harness hook detects the spoke -> fetches the context block from ContexGin -> injects it as a system reminder. No boot tokens spent until the agent goes there.

`contextBlocks` is currently a placeholder (populated as an empty Map). Implementation is tracked in [#14](https://github.com/dimakis/contexgin/issues/14).

## Agent Definitions

ContexGin serves compiled context for agents defined via declarative YAML files. Place definitions in a `.agents/` directory at your workspace root.

```yaml
kind: AgentDefinition

identity:
  name: pr-reviewer
  description: Reviews PRs against architecture docs and writing guidelines
  role: code-reviewer

provider:
  provider: anthropic
  model: claude-opus-4
  temperature: 0.3

context:
  boot:
    constitution: true
    claudeMd: true
    profile: false
    spokes: true
    tokenBudget: 12000
  operational:
    files:
      - docs/review-criteria.md
    delivery: additionalContext

governance:
  forbidden:
    - Merge PRs without two reviews
  required:
    - Check CI status before approving
  approvalRequired:
    - Force-push to any branch

metadata:
  version: '1.0'
  author: dimakis
  tags: [review, ci]
```

Two modes from the same schema:

- **Narrow agents** -- static context, single purpose. Every session compiles the same payload. A PR reviewer, a code auditor, a doc linter.
- **Dynamic agents** -- growing context over sessions. Memory scope is read-write, the vault accumulates observations and decisions.

For the full schema reference and deployment guide, see [docs/agent-definitions.md](docs/agent-definitions.md).

## Context Files

ContexGin discovers and adapts these files when scanning a workspace:

| File                  | Adapter               | Description                                                    |
| --------------------- | --------------------- | -------------------------------------------------------------- |
| `CONSTITUTION.md`     | `constitutionAdapter` | Workspace/spoke governance and architecture                    |
| `CLAUDE.md`           | `claudeAdapter`       | AI session instructions                                        |
| `.cursor/rules/*.mdc` | `cursorAdapter`       | Cursor IDE rules with frontmatter metadata                     |
| `README.md`           | `markdownAdapter`     | Project documentation                                          |
| `SERVICES.md`         | `markdownAdapter`     | Service registry                                               |
| `memory/Profile/*.md` | `markdownAdapter`     | User/workspace profile files                                   |
| `*/CONSTITUTION.md`   | `constitutionAdapter` | Spoke-level constitutions                                      |
| `.centaurignore`      | --                    | Exclude directories from graph traversal (`.gitignore` syntax) |

## Constitution Templates

See `examples/` for constitution templates:

- `hub-constitution.md` -- Root workspace with sub-repo charters, directory semantics, entry points, dependencies, boundaries
- `spoke-constitution.md` -- Leaf spoke with full I/P/O sections, principles, directory semantics
- `minimal-constitution.md` -- Bare minimum to be valid

## Production Deployment

### launchd (macOS)

1. Create the start script at `scripts/start.sh`:

```bash
#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
cd /path/to/contexgin
exec node dist/cli.js serve \
  ~/my-workspace \
  --db ~/.local/share/contexgin/graph.db \
  --goals-db ~/.local/share/contexgin/goals.db \
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

## Development

```bash
npm test           # Vitest -- 700 tests across 48 files
npm run build      # tsup (ESM + declarations)
npm run lint       # ESLint + Prettier
npm run check      # TypeScript type check
```

TDD: tests first, implementation second. Conventional commits. Feature branches with PRs -- never commit directly to main (enforced by pre-commit hook).

### Dependencies

**Runtime:** fastify, better-sqlite3, ignore, yaml
**Dev:** typescript, vitest, tsup, eslint, prettier, husky, lint-staged

No external LLM SDK dependencies in core -- provider-agnostic by design.

## Documentation

| Document                                             | Description                                          |
| ---------------------------------------------------- | ---------------------------------------------------- |
| [Architecture](docs/architecture.md)                 | Module interactions, data flow, compilation pipeline |
| [API Reference](docs/api-reference.md)               | Complete REST API with request/response schemas      |
| [Agent Definitions](docs/agent-definitions.md)       | Writing and deploying agent definitions              |
| [Origin Resolution](docs/origin-resolution.md)       | Session origin-based context injection               |
| [Goals](docs/goals.md)                               | Goal tracking and cost analysis                      |
| [Integrations](docs/integrations.md)                 | Claude Code, Cursor, Mitzo, custom agents            |
| [Adapter Layer Design](docs/design-adapter-layer.md) | Design exploration: adapter layer concept            |
| [Adapter Layer v1](docs/design-adapter-layer-v1.md)  | Implementation design for core adapters              |

## License

Private -- not yet published to npm.
