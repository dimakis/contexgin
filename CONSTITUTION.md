# Contexgin Constitution

## Purpose

Contexgin is a context orchestration engine for AI agent harnesses. It compiles,
validates, and maintains structured context payloads that AI agents consume at
session start and throughout their lifecycle. The engine is provider-agnostic:
context compilation is independent of which LLM runs the agent loop.

## Architecture

Contexgin is organised into six modules, each with a single responsibility:

| Module | Responsibility |
|--------|---------------|
| `compiler/` | Parse context sources (markdown), rank sections by relevance, trim to token budget, assemble compiled payloads |
| `integrity/` | Extract testable claims from context files, validate them against disk, produce drift reports |
| `navigation/` | Index CONSTITUTION.md files across workspace roots, generate task-relevant reading lists, enforce boundaries |
| `provider/` | Adapter interfaces for LLM providers (Claude, Codex, etc.) — session lifecycle, event streaming |
| `tools/` | Tool registry for direct function calls and MCP bridge for external tool servers |
| `permissions/` | Unified permission engine — policy evaluation across providers and tools |

### Data Flow

```
Context Sources (markdown) → Compiler → CompiledContext → Provider Adapter → Agent Session
                                ↑                              ↑
                           Integrity                      Permissions
                           (validation)                   (policy)
                                ↑
                           Navigation
                           (discovery)
```

## Directory Semantics

| Directory | Contains |
|-----------|----------|
| `src/` | All source code, organised by module |
| `tests/` | Test files mirroring src/ structure, plus fixtures |
| `dist/` | Build output (gitignored) |

## Boundaries

- This project is a **library**, not an application. It exports functions and types.
- No runtime dependencies on specific LLM providers — provider adapters are optional.
- No file mutation — the engine reads context files but never writes to them.
- No network calls in the core modules (compiler, integrity, navigation).

## Entry Points

| Export | Description |
|--------|-------------|
| `compile()` | Main compiler function — takes workspace root + options, returns CompiledContext |
| `discoverSources()` | Auto-discover context sources in a workspace |
| `extractClaims()` | Extract testable claims from context file content |
| `validateAll()` | Validate claims against filesystem, produce DriftReport |
| `indexConstitutions()` | Index CONSTITUTION.md files across workspace roots |
| `generateReadingList()` | Generate task-relevant reading list from constitution index |
