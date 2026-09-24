# Architecture

Deep dive into ContexGin's module structure, data flow, and design decisions.

## System Overview

ContexGin is a TypeScript library and HTTP daemon that compiles, validates, and serves structured context for AI agent sessions. It runs as a long-lived process that watches workspace files for changes and serves compiled context over a REST API.

```
┌─────────────────────────────────────────────────────────────────┐
│                        ContexGin Daemon                         │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │ Compiler  │   │  Graph   │   │ Adapter  │   │   Recipe    │ │
│  │          │   │          │   │          │   │             │ │
│  │ parse    │   │ hubs     │   │ claude   │   │ definitions │ │
│  │ rank     │◄──│ spokes   │◄──│ cursor   │──►│ compilation │ │
│  │ trim     │   │ edges    │   │ constit  │   │ serving     │ │
│  │ assemble │   │ validate │   │ markdown │   │             │ │
│  └──────────┘   └──────────┘   └──────────┘   └─────────────┘ │
│        │              │                              │         │
│        ▼              ▼                              ▼         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Server (Fastify)                      │   │
│  │  /health  /compile  /validate  /graph  /api/agents      │   │
│  │  /api/goals                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Watcher │  │  Store   │  │  Goals   │  │   Resolve     │  │
│  │ (fs)    │  │ (SQLite) │  │ (SQLite) │  │ (origin-based)│  │
│  └─────────┘  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Module Dependency Graph

```
                    ┌───────────┐
                    │   CLI     │
                    │ (cli.ts)  │
                    └─────┬─────┘
                          │
               ┌──────────┼───────────┐
               ▼          ▼           ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐
         │  Graph   │ │ Compiler │ │  Server  │
         └────┬─────┘ └────┬─────┘ └────┬─────┘
              │            │             │
              │     ┌──────┤        ┌────┼────────┐
              │     ▼      │        ▼    ▼        ▼
              │ ┌──────┐   │   ┌──────┐┌──────┐┌──────┐
              │ │Adapter│   │   │Recipe││Goals ││Store │
              │ └──┬───┘   │   └──┬───┘└──────┘└──────┘
              │    │       │      │
              │    ▼       │      ▼
              │ ┌──────┐   │  ┌───────┐
              └►│Integ.│   │  │Resolve│
                └──────┘   │  └───────┘
                           │
                    ┌──────┤
                    ▼      ▼
              ┌──────┐ ┌──────────┐
              │Navig.│ │Benchmarks│
              └──────┘ └──────────┘
```

Arrows indicate "depends on" relationships. The server wires modules together; most modules are independently testable.

## Context Compilation Pipeline

The core value of ContexGin is the compilation pipeline -- turning heterogeneous workspace files into a ranked, budget-aware context payload.

### Pipeline Stages

```
1. Discovery          2. Adaptation         3. Ranking            4. Trimming         5. Assembly
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Walk workspace│    │ Format-aware │    │ Score by     │    │ Enforce      │    │ Group by     │
│ Find context │───►│ parsing into │───►│ tier weight  │───►│ token budget │───►│ type, emit   │
│ files         │    │ ContextNodes │    │ + task boost │    │ + dedup      │    │ boot payload │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

### Stage 1: Discovery

`discoverSources(workspaceRoot)` walks the workspace and finds files that contain AI-relevant context:

- `CONSTITUTION.md` at the root and in each spoke
- `CLAUDE.md` at the root
- `.cursor/rules/*.mdc` files
- `memory/Profile/*.md` files
- `README.md`, `SERVICES.md`

Directories matching `.centaurignore` patterns are skipped (uses `.gitignore` syntax via the `ignore` npm package).

### Stage 2: Adaptation

Each discovered file is matched to a **context adapter** that knows how to parse its specific format:

| Adapter               | Source Format         | What It Extracts                                                                     |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `constitutionAdapter` | `CONSTITUTION.md`     | Purpose, directory semantics, entry points, dependencies, boundaries, spoke charters |
| `claudeAdapter`       | `CLAUDE.md`           | Operational rules: git discipline, entry points, conventions, boundaries             |
| `cursorAdapter`       | `.cursor/rules/*.mdc` | Rules with YAML frontmatter: `alwaysApply`, `globs` metadata                         |
| `markdownAdapter`     | `README.md`, `*.md`   | Generic heading-based extraction with keyword classification                         |

Adapters are ordered by specificity in a registry. `CONSTITUTION.md` hits the constitution adapter first, not the markdown fallback. Each adapter emits typed `ContextNode` objects:

```typescript
interface ContextNode {
  id: string; // e.g., "git-discipline", "spoke:command_center"
  type: ContextNodeType; // structural | operational | identity | governance | reference
  tier: ContextTier; // constitutional | navigational | identity | reference | historical
  content: string; // The actual context text (markdown)
  origin: NodeOrigin; // Source file, format, heading path
  tokenEstimate: number; // ~4 chars/token heuristic
}
```

**Why both `type` and `tier`?** They are orthogonal. `type` answers _what kind_ of context it is (architecture vs rules vs identity). `tier` answers _how important_ it is for the agent's first impression. A governance rule can be constitutional-tier (hard boundary -- always include) or reference-tier (soft guidance -- trim under budget pressure). The compiler groups output by `type` and ranks within groups by `tier`.

### Stage 3: Ranking

Sections are scored by their tier weight, with optional task-hint boosting:

| Tier           | Weight |
| -------------- | ------ |
| Constitutional | 1.0    |
| Navigational   | 0.8    |
| Operational    | 0.75   |
| Identity       | 0.7    |
| Reference      | 0.5    |
| Historical     | 0.3    |

**Spoke penalty**: Spoke-level content receives a 0.35 relevance penalty. Hub-level context is instructions; spoke-level is context.

**Task boosting**: When a `taskHint` is provided (e.g., "fix the payment retry logic"), sections whose content matches the hint get a relevance boost of up to +0.2. This surfaces task-relevant context that might otherwise be trimmed.

### Stage 4: Trimming

`trimToBudget(ranked, budget)` enforces the token ceiling:

1. Sort sections by score (descending)
2. Include sections until budget is exhausted
3. Deduplicate content that appears in multiple sources
4. Track what was trimmed (available in `CompiledContext.trimmed`)

### Stage 5: Assembly

Included sections are grouped by type and assembled into the final payload:

```markdown
## Governance

[governance nodes -- boundaries, principles, access rules]

## Architecture

[structural nodes -- spoke topology, directory semantics, dependencies]

## Conventions

[operational nodes -- git discipline, entry points, coding rules]

## Reference

[reference + identity nodes -- services, profile, memory]
```

The output is a `CompiledContext` object containing the `bootPayload` (string), `nodes` (typed array), `navigationHints`, token counts, and metadata about what was included and trimmed.

## Hub-Spoke Graph

The graph module builds a structural representation of the workspace from constitutions.

### Types

```typescript
interface Hub {
  id: string; // Derived from path
  path: string; // Absolute filesystem path
  name: string; // Directory name
  constitution: Constitution; // Parsed constitution
  spokes: Spoke[]; // Child spokes
  externals: ExternalRef[]; // References to other hubs
}

interface Spoke {
  id: string;
  name: string;
  path: string;
  parentId: string;
  constitution: Constitution | null;
  children: Spoke[];
  confidentiality: 'none' | 'soft' | 'hard';
  audience?: string;
  governance?: string;
}

interface HubGraph {
  hubs: Hub[];
  edges: Edge[];
  violations: Violation[];
}
```

### Edge Types

Dependencies between spokes are expressed as typed edges:

| Kind           | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `contains`     | Parent-child spoke relationship                    |
| `depends_on`   | Spoke depends on another for data or functionality |
| `external`     | Reference to an external hub                       |
| `produces_for` | Spoke produces output consumed by another          |
| `reads_from`   | Spoke reads data from another                      |
| `governed_by`  | Spoke is governed by another's rules               |

### Structural Validation (Level 1)

Checks the workspace filesystem against what the constitution declares:

- Declared directories exist
- Declared files exist
- No undeclared directories (respecting `.centaurignore`)
- Spoke nesting depth does not exceed 2
- All spokes have constitutions

### Relational Validation (Level 2)

Checks relationships between graph nodes:

- Dependencies resolve to existing spokes or hubs
- External references point to real directories with constitutions
- Boundaries are consistent (no conflicting access rules)
- Entry points are callable
- Cross-spoke references resolve correctly

### Boundary Enforcement

Spokes declare confidentiality levels:

| Level  | Meaning                                                      |
| ------ | ------------------------------------------------------------ |
| `none` | Open access -- any agent can read                            |
| `soft` | Accessible but logged -- compiler notes the access           |
| `hard` | Blocked -- compiler will not include content from this spoke |

Boundaries are enforced at compile time: an agent definition that excludes a `hard` spoke will never receive its content, regardless of task hints or relevance scoring.

## Agent Recipe System

The recipe module turns declarative YAML agent definitions into compiled context payloads.

### Flow

```
.agents/pr-reviewer.yaml          loadAgentDefinition()
        │                                 │
        ▼                                 ▼
AgentDefinition (typed)  ───────►  compileAgent(def, root, origin?)
                                          │
                                          ├─── Resolve origin (if provided)
                                          ├─── Discover + adapt sources
                                          ├─── Apply agent's source filters
                                          ├─── Compile within token budget
                                          │
                                          ▼
                                 CompiledAgentContext
                                  ├── identity
                                  ├── bootContext (content, tokens, sources)
                                  ├── contextBlocks
                                  ├── operational (files, delivery)
                                  ├── memory (feedback, user, project, reference)
                                  ├── governance (forbidden, required, approvalRequired)
                                  ├── skills
                                  └── provider (model, temperature, etc.)
```

Agent definitions are discovered in `.agents/` directories within workspace roots. The daemon caches discovered definitions for 30 seconds to avoid repeated filesystem scans.

### Narrow vs Dynamic Agents

- **Narrow**: Static context. Every session compiles the same payload. No memory persistence. Examples: PR reviewer, code auditor, doc linter.
- **Dynamic**: Growing context over sessions. Memory scope is read-write. The vault accumulates observations and decisions. The compiler includes relevant vault content ranked by recency.

## Origin Resolution

The resolve module determines what _additional_ context to inject based on how a session was triggered.

```
Session triggered with origin metadata
        │
        ▼
findResolver(origin.source)
        │
        ▼
resolver.resolve(origin, root, defaults)
        │
        ▼
ResolvedManifest
  ├── sources (additional context sources)
  ├── excluded (sections to exclude)
  └── taskHint (injected task hint)
```

**Available resolvers:**

| Resolver           | Trigger            | What It Does                                        |
| ------------------ | ------------------ | --------------------------------------------------- |
| `chatResolver`     | Interactive chat   | No-op -- returns empty manifest (defaults are fine) |
| `telosResolver`    | Telos task item    | Injects task description as task hint               |
| `calendarResolver` | Calendar event     | Adds meeting-relevant context                       |
| `fileResolver`     | File opened/edited | Scopes context to the file's spoke                  |

The resolved manifest is merged with the agent definition's defaults before compilation. Origin-provided hints and exclusions layer on top of, not replace, the base definition.

## Goal Tracking

The goals module associates agent goals with token usage for cost analysis.

### Data Model

```
Goal
  ├── id, title, description
  ├── status: active | achieved | failed | abandoned
  ├── contextCondition: none | compiled | partial | unknown
  ├── successCriteria: string[]
  ├── bootPayloadTokens: number
  │
  ├── contributions[]
  │     ├── source, sourceId, sourceLabel
  │     ├── inputTokens, outputTokens
  │     ├── cacheReadTokens, cacheCreationTokens
  │     ├── costUsd, turns, toolCalls
  │     ├── durationMs, durationApiMs
  │     └── metadata
  │
  └── artifacts[]
        ├── type (pr, commit, file, etc.)
        ├── ref (PR URL, commit SHA, file path)
        └── repo
```

Goals track the **cost of achieving an outcome** -- not just tokens consumed, but which sessions contributed, what artifacts were produced, and whether compiled context made a difference (`contextCondition`).

Persistence is via SQLite (WAL mode) -- the same approach as the graph store. Both can be configured in-memory for testing or persistent for production.

## Server Architecture

The daemon is built on Fastify with a simple state management model:

### Lifecycle

1. **Create** -- `createServer(config)` initializes Fastify, registers routes, creates SQLite stores
2. **Build** -- `server.rebuild()` constructs the structural graph from all configured roots
3. **Listen** -- `startListeners(server, config)` binds to TCP port and/or Unix socket
4. **Watch** -- `startWatcher(server, config)` watches for CONSTITUTION.md and CLAUDE.md changes
5. **Serve** -- daemon handles requests, auto-rebuilds on file changes (debounced at 500ms)
6. **Shutdown** -- closes watcher, shuts down Fastify

### State

```typescript
interface ServerState {
  graph: HubGraph | null; // Current structural graph
  lastBuild: Date | null; // When graph was last built
  startedAt: Date; // Server start time
  rebuilding: boolean; // Whether a rebuild is in progress
  violations: {
    // Counts from last validation
    errors: number;
    warnings: number;
    info: number;
  };
}
```

The state is held in memory and rebuilt from filesystem on changes. The `GraphStore` (SQLite) provides persistence for snapshots across restarts.

### File Watching

The watcher monitors `CONSTITUTION.md` and `CLAUDE.md` files across all workspace roots. On change:

1. Debounce (500ms default)
2. Rebuild the graph from scratch
3. Run validation
4. Update server state with new graph and violation counts

This ensures the API always serves current data without requiring manual rebuilds.

## Design Decisions

### Read-Only by Design

ContexGin never writes to workspace files. It reads constitutions, context files, and agent definitions. It validates and compiles. It does not modify, scaffold, or generate content. This is a deliberate design choice: the system that validates should not be the system that writes. Separation of concerns.

### Provider-Agnostic Core

The core library has zero LLM SDK dependencies. The `provider` module defines interfaces (`AgentProvider`, `AgentSession`) but ships no implementations. Provider-specific code lives in the consuming harness (Mitzo, Claude Code, etc.), not in ContexGin.

### Structured Extraction Only

Context is extracted from structured elements in markdown: headings, tables, lists, code blocks. No prose mining, no NLP, no LLM-based extraction. This keeps extraction deterministic and testable. The compiler always produces the same output for the same input.

### Token Budget as Hard Constraint

The token budget is a hard ceiling, not a target. The trimmer will drop lower-ranked sections to stay within budget. This prevents context bloat, which is the single biggest source of agent confusion in large workspaces.

### SQLite for Persistence

Both the graph store and goal store use SQLite with WAL mode. This provides crash-safe persistence, concurrent read access, and zero-config deployment. In-memory mode (`:memory:`) is available for testing and ephemeral use.
