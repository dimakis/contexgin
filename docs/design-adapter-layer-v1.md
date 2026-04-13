# Adapter Layer v1: Implementation Design

**Status:** Decision
**Date:** 2026-04-14
**Origin:** [design-adapter-layer.md](design-adapter-layer.md) (Thought), conversation about wiring structured context into Centaur reviewer
**Depends on:** Phase 1 (Structural Graph) — complete

## Goal

Replace the compiler's flat markdown-section pipeline with format-aware adapters that emit typed **context nodes**. The Centaur reviewer gets structured context (governance vs reference vs operational) instead of a text blob — enabling violation-aware reviews like "this PR breaks a convention declared in CLAUDE.md."

## Scope: Three Core Adapters

Only the formats that matter for PR review today. No sidecar/ingest API yet (that's Cogenti scope).

| Adapter                | Source                | What it extracts                                                                             |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `claude_adapter`       | `CLAUDE.md`           | Operational rules: git discipline, entry points, working conventions, tool usage, boundaries |
| `cursor_adapter`       | `.cursor/rules/*.mdc` | Operational rules: frontmatter-aware parsing, `alwaysApply` / `globs` metadata               |
| `constitution_adapter` | `CONSTITUTION.md`     | Structural contracts: purpose, directory semantics, spoke charters, dependencies, boundaries |

A generic `markdown_adapter` (README, SERVICES.md, etc.) handles anything that doesn't match the above — extracts sections by heading, classifies by keyword heuristics (existing ranker logic).

## Context Node Model

The new internal unit. Replaces `ExtractedSection` as the compiler's input.

```typescript
interface ContextNode {
  /** Unique ID within the source (e.g. "git-discipline", "spoke:command_center") */
  id: string;

  /** What kind of context this is */
  type: 'structural' | 'operational' | 'identity' | 'governance' | 'reference';

  /** Relevance tier for ranking */
  tier: 'constitutional' | 'navigational' | 'identity' | 'reference' | 'historical';

  /** The actual context content (markdown) */
  content: string;

  /** Where this came from */
  origin: {
    /** Absolute path or URI */
    source: string;
    /** Relative path within workspace */
    relativePath: string;
    /** Source format */
    format: 'claude_md' | 'cursor_rules' | 'constitution' | 'markdown';
    /** Heading path if applicable */
    headingPath?: string[];
  };

  /** Approximate token count */
  tokenEstimate: number;
}
```

### Type Taxonomy

| Type          | Meaning                                   | Examples                                                 |
| ------------- | ----------------------------------------- | -------------------------------------------------------- |
| `structural`  | Architecture, topology, what exists where | Spoke charters, directory trees, dependency declarations |
| `operational` | How to work in this repo                  | Git conventions, entry points, tool usage, coding rules  |
| `identity`    | Who/what this workspace is                | Purpose, profile, communication style                    |
| `governance`  | What must/must not happen                 | Boundaries, access rules, principles, confidentiality    |
| `reference`   | Pointers to other resources               | Service URLs, external docs, memory observations         |

## Adapter Interface

```typescript
interface ContextAdapter {
  /** Which source format this adapter handles */
  format: string;

  /** Whether this adapter can handle the given file */
  canHandle(filePath: string): boolean;

  /** Parse + classify + normalize a source file into context nodes */
  adapt(filePath: string, workspaceRoot: string): Promise<ContextNode[]>;
}
```

Each adapter is a pure function: file in, nodes out. No side effects, no state.

## Adapter Details

### `claude_adapter`

Parses CLAUDE.md by h2 sections. Classification rules:

| Section heading pattern            | Type          | Tier             |
| ---------------------------------- | ------------- | ---------------- |
| Purpose, Identity, About           | `identity`    | `identity`       |
| Git, Commit, Branch, Workflow      | `operational` | `navigational`   |
| Entry Point, CLI, Command, Script  | `operational` | `navigational`   |
| Boundary, Confidential, Access     | `governance`  | `constitutional` |
| Architecture, Structure, Directory | `structural`  | `navigational`   |
| Memory, Agent, Session             | `reference`   | `reference`      |
| everything else                    | `operational` | `reference`      |

Emits one node per h2 section. Section ID derived from slugified heading.

### `cursor_adapter`

Parses `.cursor/rules/*.mdc` files. Each file has YAML frontmatter:

```yaml
---
description: '...'
globs: '*.py'
alwaysApply: true
---
```

One node per `.mdc` file. Metadata drives classification:

- `alwaysApply: true` + governance keywords → `governance` / `constitutional`
- `globs` present → `operational` / `navigational` (scoped to file patterns)
- Default → `operational` / `reference`

Preserves `globs` in the node so the compiler can scope context to changed files in a PR.

### `constitution_adapter`

Wraps the existing `graph/parser.ts` output. Maps parsed constitution fields to nodes:

| Constitution field     | Node type     | Tier             |
| ---------------------- | ------------- | ---------------- |
| Purpose                | `identity`    | `constitutional` |
| Directory semantics    | `structural`  | `navigational`   |
| Entry points           | `operational` | `navigational`   |
| Dependencies           | `structural`  | `navigational`   |
| Boundaries             | `governance`  | `constitutional` |
| Spoke charters         | `structural`  | `navigational`   |
| Public API / Contracts | `structural`  | `constitutional` |

Reuses `parseConstitution()` — no duplicate parsing logic.

### `markdown_adapter` (fallback)

For README.md, SERVICES.md, and any other `.md` files discovered. Uses the existing heading-based extraction + keyword classification from the current ranker. This is essentially what the compiler does today, wrapped in the adapter interface.

## Compiler Changes

### Discovery

`discoverSources()` evolves to return adapter-matched files:

```typescript
async function discoverSources(workspaceRoot: string): Promise<AdaptedSource[]> {
  // 1. Walk workspace (respecting .centaurignore)
  // 2. For each file, find first adapter where canHandle() returns true
  // 3. Return matched pairs: { adapter, filePath }
}
```

Order matters — constitution_adapter checked before markdown_adapter so CONSTITUTION.md doesn't fall through to generic markdown.

### Compilation Pipeline

```
discoverSources()
    │
    ▼
adapter.adapt() for each source     ← NEW: format-aware parsing
    │
    ▼
ContextNode[]                        ← NEW: typed nodes, not raw sections
    │
    ▼
rankNodes(nodes, { taskHint })       ← EVOLVED: rank by node type + tier + task boost
    │
    ▼
trimToBudget(ranked, budget)         ← UNCHANGED: token trimming
    │
    ▼
assemblePayload(included)            ← EVOLVED: group by type in output
```

### Payload Assembly

The compiled output groups nodes by type so consumers can reason about categories:

```
## Governance
[governance nodes — boundaries, principles, access rules]

## Architecture
[structural nodes — spoke topology, directory semantics, dependencies]

## Conventions
[operational nodes — git discipline, entry points, coding rules]

## Reference
[reference + identity nodes — services, profile, memory]
```

This gives the Centaur reviewer explicit sections to reference when flagging violations.

### `CompiledContext` Evolution

```typescript
interface CompiledContext {
  bootPayload: string; // assembled payload (grouped by type)
  contextBlocks: Map<string, string>; // deferred per-turn blocks (future)
  navigationHints: string[];
  bootTokens: number;
  sources: ContextSource[]; // keep for backwards compat
  trimmed: ContextNode[]; // was ExtractedSection[]
  nodes: ContextNode[]; // NEW: all included nodes, typed
}
```

Adding `nodes` lets Centaur optionally consume structured nodes instead of just the flat `bootPayload`. The `/compile` endpoint returns both.

## Centaur Integration

### API Change

`/compile` response gains an optional `nodes` array:

```json
{
  "context": "## Governance\n...\n## Architecture\n...",
  "tokens": 4200,
  "sources": 8,
  "spoke": "~/redhat/mgmt",
  "nodes": [
    {
      "id": "git-discipline",
      "type": "operational",
      "tier": "navigational",
      "content": "...",
      "origin": { "format": "claude_md", "relativePath": "CLAUDE.md" }
    }
  ]
}
```

### Reviewer Plugin

`ContexGinClient.compile()` returns `CompiledContext` with both `context` (string, for prompt injection) and `nodes` (structured, for reviewer logic). The reviewer can:

1. **Short term**: Use the grouped `context` string as-is — already better than today because governance rules are separated and labeled
2. **Next step**: Filter nodes by type to build targeted review prompts (e.g., only inject governance nodes when checking convention violations)

## File Layout

```
src/
  adapter/                    # NEW module
    types.ts                  # ContextNode, ContextAdapter interface
    index.ts                  # public API: adaptFile(), discoverAndAdapt()
    claude.ts                 # claude_adapter
    cursor.ts                 # cursor_adapter
    constitution.ts           # constitution_adapter (wraps graph/parser)
    markdown.ts               # markdown_adapter (wraps existing extractor)
    registry.ts               # adapter selection: canHandle() dispatch
  compiler/
    index.ts                  # updated pipeline: adapters → rank → trim → assemble
    ranker.ts                 # updated: ranks ContextNode[] instead of ExtractedSection[]
    types.ts                  # ContextNode added, ExtractedSection kept for compat
    ...
```

## Execution Plan

### Step 1: Context Node Types + Adapter Interface

- `src/adapter/types.ts` — `ContextNode`, `ContextAdapter`, type enums
- Tests: type validation, node construction helpers

### Step 2: Markdown Adapter (migration bridge)

- `src/adapter/markdown.ts` — wraps existing extractor + ranker classification
- Tests: verify identical output to current pipeline for CONSTITUTION.md and CLAUDE.md
- This is the safety net: existing behavior preserved before we specialize

### Step 3: Claude Adapter

- `src/adapter/claude.ts` — h2 section parsing with classification rules table above
- Tests: parse mgmt's CLAUDE.md, verify correct type/tier assignments

### Step 4: Cursor Adapter

- `src/adapter/cursor.ts` — frontmatter-aware .mdc parsing
- Tests: parse mgmt's `.cursor/rules/`, verify globs and alwaysApply handling

### Step 5: Constitution Adapter

- `src/adapter/constitution.ts` — wrap `parseConstitution()` output as nodes
- Tests: parse mgmt's CONSTITUTION.md, verify structural nodes match graph output

### Step 6: Adapter Registry + Discovery

- `src/adapter/registry.ts` — ordered adapter dispatch
- `src/adapter/index.ts` — `adaptFile()`, `discoverAndAdapt()`
- Tests: correct adapter selected for each file type, fallback to markdown

### Step 7: Compiler Integration

- Update `compile()` to use adapter pipeline
- Update ranker to work with `ContextNode[]`
- Update payload assembly to group by type
- Add `nodes` to `CompiledContext`
- Tests: end-to-end compile produces grouped output, backwards-compatible `bootPayload`

### Step 8: Server + API

- Update `/compile` route to return `nodes` in response
- Tests: API returns structured nodes alongside existing fields

### Step 9: Centaur Client Update

- Update `ContexGinClient.compile()` to parse `nodes` from response
- Update `CompiledContext` dataclass
- Tests: client handles both old (no nodes) and new responses

## What This Does NOT Do

- Sidecar adapters / ingest API — Cogenti scope, not needed yet
- Output format adapters (Claude vs OpenAI payload shape) — future
- Per-turn context blocks (#14) — orthogonal, tracked separately
- Semantic validation (LLM-based) — Phase 3
- Multi-tenant isolation — Cogenti scope

## Success Criteria

1. `npm test` passes — all existing + new adapter tests
2. `npx contexgin compile ~/redhat/mgmt` produces grouped output with typed nodes
3. Centaur reviewer receives structured context with governance/architecture/convention sections
4. No regression: repos without CLAUDE.md or .cursor/rules still compile via markdown fallback
5. Adapter for mgmt workspace classifies git discipline as `operational`, boundaries as `governance`, spoke charters as `structural`

## Open Questions (Scoped to v1)

- **Heading depth**: Should claude_adapter go deeper than h2? Some CLAUDE.md files nest important rules under h3.
  - Proposal: extract at h2, but include h3 content within the h2 node. Split h3 into separate nodes only if the h2 section exceeds ~1000 tokens.
- **Cursor rule deduplication**: If `.cursor/rules/foo.mdc` duplicates content from CLAUDE.md, should we deduplicate?
  - Proposal: no, for v1. The ranker + budget trimmer naturally handles redundancy. Dedup is a compiler optimization, not an adapter concern.
- **Node ordering within type groups**: Within the "Governance" section of the payload, what order?
  - Proposal: by tier (constitutional first), then by relevance score within tier.
