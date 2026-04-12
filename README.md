# Contexgin

Context infrastructure for the [Centaur](https://github.com/dimakis/centaur) agent ecosystem. Compiles, validates, and maintains structured context payloads that agents consume at boot and throughout their lifecycle.

Contexgin is opinionated. It works with the primitives defined in the Centaur ecosystem — hubs, spokes, constitutions, boundaries. If your workspace follows this topology, Contexgin can compile context for it, validate its structural integrity, and serve it over an API. If it doesn't, Contexgin isn't the right tool.

**Provider-agnostic** — context compilation is independent of which LLM runs the agent loop.

## The Hub-Spoke Model

Contexgin organises workspaces as a **hub-spoke topology**. This is the foundational pattern everything else builds on.

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
- **Structural validation** — constitutions declare what should exist. Contexgin checks whether reality matches. Drift is detected, not assumed away.
- **Cross-workspace federation** — multiple hubs connect through external references. A management hub can depend on a projects hub without either owning the other.

The hub-spoke model isn't a universal standard — it's a deliberate implementation choice for workspaces where structured context matters more than ad-hoc discovery.

## What Contexgin Does

Agent harnesses (Claude Code, Cursor, Codex CLI) solve tool calling and user experience — and those are genuinely hard problems. Contexgin doesn't replace any of that. It solves a complementary problem: **what context does the agent receive, and how do you keep it honest?**

A well-contexted agent session starts closer to understanding. It doesn't ask questions the workspace already answers, doesn't violate conventions it wasn't told about, doesn't waste tokens rediscovering what could have been stated. The gap between a bare session and a context-compiled session is immediately measurable in tokens spent to reach a correct result.

Contexgin automates the discipline: parse constitutions, rank sections by relevance, trim to a token budget, validate that declared structure matches reality, and serve it all over an API.

## Agent Definitions

Centaur defines agents as **tools + compiled context + governance + output conventions**. Contexgin compiles the context portion — it reads the hub-spoke topology but does not parse agent definition files directly. Agent definition schemas (YAML configs describing context sources, budgets, modes, and governance boundaries) live in the [Centaur repo](https://github.com/dimakis/centaur/tree/main/schemas/agent/).

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

### Tools

Registry for managing available tools in an agent session. Tools are registered by name and looked up at runtime during context compilation.

Source: `src/tools/registry.ts`

### Permissions

Policy engine for tool-level access control. Evaluates permission requests against a rule set (with glob matching) — first matching rule wins, with a configurable default decision.

Source: `src/permissions/policy.ts`

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
  bootPayload: string; // System prompt content
  contextBlocks: Map<string, string>; // Per-turn injections
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

Contexgin discovers these files when scanning a workspace:

| File                  | Kind         | Description                                 |
| --------------------- | ------------ | ------------------------------------------- |
| `CONSTITUTION.md`     | constitution | Workspace/spoke governance and architecture |
| `CLAUDE.md`           | reference    | AI session instructions                     |
| `SERVICES.md`         | service      | Service registry                            |
| `memory/Profile/*.md` | profile      | User/workspace profile files                |
| `*/CONSTITUTION.md`   | constitution | Spoke-level constitutions                   |

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
