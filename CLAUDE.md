# Contexgin

A context orchestration engine for AI agent harnesses.

## What This Is

TypeScript library + HTTP daemon that compiles, validates, and maintains context
for AI agent sessions. It is provider-agnostic — context compilation is
independent of which LLM runs the agent loop. The daemon runs as a launchd
service on port 4195, serving the library's capabilities over HTTP.

## Architecture

See CONSTITUTION.md for full architecture.

Core modules:

- `compiler/` — Parses context sources, ranks by relevance, trims to token budget
- `integrity/` — Validates context claims against disk, detects drift
- `navigation/` — Indexes constitutions, generates reading lists, enforces boundaries
- `graph/` — Parses CONSTITUTION.md, builds Hub/Spoke topology, validates structural relationships
- `server/` — Fastify daemon: `/health`, `/compile`, `/validate`, `/graph` endpoints
- `provider/` — Adapter interfaces for LLM providers (Claude, Codex, etc.)
- `tools/` — Tool registry (direct function calls, MCP bridge for external)
- `permissions/` — Unified permission engine across providers

## Development

- TDD: write tests first, implementation second
- `npm test` — run all tests (Vitest)
- `npm run build` — build with tsup
- `npm run lint` — ESLint + Prettier check
- Conventional commits: `<type>(scope): description`
- Feature branches: `feat/<name>`, `fix/<name>` — PR to main

## Key Concepts

### Context Sources

Markdown files that describe a workspace: constitutions, profiles, memory,
services. The compiler parses these and assembles optimised payloads.

### Claims

Testable assertions extracted from context files: "this file exists",
"this directory contains auth code", "these are the entry points".
The integrity layer validates claims against reality.

### Compiled Context

The output of the compiler: a structured payload containing boot context,
per-turn injections, and navigation hints, trimmed to a token budget.

### Structural Graph

Hub/Spoke topology parsed from CONSTITUTION.md files. Hubs are workspace roots,
spokes are sub-repos or directories with their own constitutions. The graph
enables structural validation — detecting drift between what constitutions
declare and what actually exists on disk.

## Daemon

The server module runs as a long-lived Fastify process:

```bash
# Start locally
node dist/cli.js serve ~/redhat/mgmt --port 4195

# Or via launchd (production)
launchctl load ~/Library/LaunchAgents/com.contexgin.server.plist
```

API endpoints:

- `GET /health` — status, hub/spoke count, violation summary, uptime
- `POST /compile` — compile context for a spoke (`{spoke, task?, budget?}`)
- `POST /validate` — full structural validation with violation details
- `GET /graph` — full graph topology
- `GET /graph/:hubId` — single hub detail

The daemon watches CONSTITUTION.md and CLAUDE.md files and auto-rebuilds
the graph when they change. SQLite persistence (WAL mode) stores snapshots
so restarts are instant.

## Consumers

The daemon is consumed by mgmt's command center infrastructure:

- **Morning briefing** — queries `/health` for workspace health section
- **Telos** — queries `/validate` for violation-based todo items
- **Drift agent** — queries `/health` daily, posts inbox proposals on errors
