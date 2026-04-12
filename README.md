# Contexgin

A context orchestration engine for AI agent harnesses. Compiles, validates, and maintains structured context payloads that AI agents consume at session start and throughout their lifecycle.

**Provider-agnostic** — context compilation is independent of which LLM runs the agent loop.

## Why

Agent harnesses (Claude Code, Codex CLI, Cursor) solve tool calling and UX. Nobody solves context. The hard problem isn't "call a function" — it's "know what to inject, when to refresh it, and how to keep it honest."

Contexgin automates that discipline: parse your workspace's context files, rank sections by relevance, trim to a token budget, and validate that the context still matches reality.

## Install

```bash
npm install github:dimakis/contexgin
```

## Quick Start

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

**Relevance tiers** (highest → lowest):

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

### Provider / Tools / Permissions

Type definitions and interfaces only — no runtime implementation yet. These define the contracts for future LLM provider adapters, tool registries, and permission engines.

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

ContexGin includes a long-lived HTTP daemon that serves the library's capabilities over a REST API. It watches your workspace for constitution changes and auto-rebuilds the structural graph.

### Quick Start (Daemon)

```bash
# Build
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
# → {"status":"ok","hubs":3,"spokes":15,"violations":{"errors":4,"warnings":18,"info":12},...}

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

### Integration Examples

#### Claude Code (CLAUDE.md hook)

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

## Development

```bash
npm test           # Vitest — 235 tests across 23 files
npm run build      # tsup (ESM + declarations)
npm run lint       # ESLint + Prettier
npm run check      # TypeScript type check
```

TDD: tests first, implementation second. Conventional commits. Feature branches with PRs.

## Context Files It Understands

Contexgin looks for these files when discovering context sources:

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

## License

Private — not yet published to npm.
