# Contexgin

A context orchestration engine for AI agent harnesses.

## What This Is

Standalone TypeScript library that compiles, validates, and maintains context
for AI agent sessions. It is provider-agnostic — context compilation is
independent of which LLM runs the agent loop.

## Architecture

See CONSTITUTION.md for full architecture.

Core modules:
- `compiler/` — Parses context sources, ranks by relevance, trims to token budget
- `integrity/` — Validates context claims against disk, detects drift
- `navigation/` — Indexes constitutions, generates reading lists, enforces boundaries
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
