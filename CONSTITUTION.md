# Contexgin Constitution

## Purpose

Contexgin is a context orchestration engine for AI agent harnesses. It compiles,
validates, and maintains structured context payloads that AI agents consume at
session start and throughout their lifecycle. The engine is provider-agnostic:
context compilation is independent of which LLM runs the agent loop.

## Architecture

Contexgin is organised into eight modules, each with a single responsibility:

| Module         | Responsibility                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `compiler/`    | Parse context sources (markdown), rank sections by relevance, trim to token budget, assemble compiled payloads                |
| `integrity/`   | Extract testable claims from context files, validate them against disk, produce drift reports                                 |
| `navigation/`  | Index CONSTITUTION.md files across workspace roots, generate task-relevant reading lists, enforce boundaries                  |
| `graph/`       | Parse CONSTITUTION.md into typed structures, build Hub/Spoke topology, validate structural relationships                      |
| `server/`      | Fastify HTTP daemon — `/health`, `/compile`, `/validate`, `/graph` endpoints. SQLite persistence, file watching, auto-rebuild |
| `provider/`    | Adapter interfaces for LLM providers (Claude, Codex, etc.) — session lifecycle, event streaming                               |
| `tools/`       | Tool registry for direct function calls and MCP bridge for external tool servers                                              |
| `permissions/` | Unified permission engine — policy evaluation across providers and tools                                                      |

### Data Flow

```
Context Sources (markdown) → Compiler → CompiledContext → Provider Adapter → Agent Session
                                ↑                              ↑
                           Integrity                      Permissions
                           (validation)                   (policy)
                                ↑
                           Navigation
                           (discovery)
                                ↑
                         Graph (structural)
                              ↑
                     Server (daemon, HTTP API)
```

## Directory Semantics

| Directory   | Contains                                             |
| ----------- | ---------------------------------------------------- |
| `src/`      | All source code, organised by module                 |
| `tests/`    | Test files mirroring src/ structure, plus fixtures   |
| `dist/`     | Build output (gitignored)                            |
| `scripts/`  | Daemon start script for launchd                      |
| `logs/`     | Daemon stdout/stderr logs (gitignored)               |
| `examples/` | Constitution templates for onboarding new workspaces |

## Boundaries

- The core modules (compiler, integrity, navigation, graph) are a **library** — they export functions and types.
- The server module is an **application** — a long-lived Fastify daemon serving the library's capabilities over HTTP.
- No runtime dependencies on specific LLM providers — provider adapters are optional.
- No file mutation — the engine reads context files but never writes to them.
- No network calls in the core modules (compiler, integrity, navigation, graph). Only the server module listens on a network port.

## Entry Points

| Export                  | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `compile()`             | Main compiler function — takes workspace root + options, returns CompiledContext |
| `discoverSources()`     | Auto-discover context sources in a workspace                                     |
| `extractClaims()`       | Extract testable claims from context file content                                |
| `validateAll()`         | Validate claims against filesystem, produce DriftReport                          |
| `indexConstitutions()`  | Index CONSTITUTION.md files across workspace roots                               |
| `generateReadingList()` | Generate task-relevant reading list from constitution index                      |
| `buildGraph()`          | Build Hub/Spoke structural graph from workspace roots                            |
| `validateGraph()`       | Validate structural relationships, produce violations                            |
| `createServer()`        | Create Fastify daemon instance with all routes and state                         |
