# Phase 1: Structural Graph — Execution Plan

**Date**: 2026-04-11
**Status**: Ready to execute
**Strategy**: See `~/redhat/mgmt/architecture/discussions/contexgin/next-phase-strategy.md`

---

## Goal

Replace prose-mining claim extraction with a graph-aware structural model. Run against mgmt + projects workspaces with zero false positives.

## Outcome

`contexgin validate ~/redhat/mgmt` produces only true violations. The 162 false positives from backtick-path extraction are gone. The structural graph becomes the foundation for the daemon, API, and Rust port.

---

## Architecture After This Phase

```
src/
  compiler/          # existing — unchanged
  integrity/         # evolved — uses graph for validation instead of prose-mining
  navigation/        # existing — feeds into graph builder
  permissions/       # existing — unchanged
  provider/          # existing — unchanged
  tools/             # existing — unchanged
  graph/             # NEW — structural graph
    types.ts         # Hub, Spoke, Constitution, Dependency, Boundary, EntryPoint, Violation
    parser.ts        # parseConstitution() — structured extraction from tables
    builder.ts       # buildGraph() — assemble Hub/Spoke topology from parsed constitutions
    query.ts         # resolveReference(), traverseDependencies(), isAccessible()
    ignore.ts        # loadIgnorePatterns(), shouldIgnore() — .centaurignore support
    validate.ts      # validateGraph() — Level 1 + 2 violation detection
    index.ts         # public API
  index.ts           # add graph exports
```

---

## Steps

### Step 1: Graph Primitives (`src/graph/types.ts`)

Define the 7 context primitives as TypeScript interfaces. These mirror the shared primitives spec from `centaur-shared-primitives.md` but are the working TS implementation.

```typescript
// Core node types
Hub; // top-level workspace: root_path, constitution, spokes[]
Spoke; // bounded context: name, path, parent, constitution, confidentiality
Constitution; // parsed structural contract: purpose, tree, entryPoints, dependencies, boundaries

// Edge types
Dependency; // typed directional edge: from, to, kind (contains/depends_on/external/produces_for/reads_from)

// Constraint types
Boundary; // confidentiality rule: spoke, level (none/soft/hard), excludedFrom[]
EntryPoint; // executable command: name, command, description, spoke

// Output types
Violation; // drift detection: kind, severity, location, declared, actual, source, message, suggestion?
ViolationKind; // missing_directory, missing_file, undeclared_directory, missing_constitution,
// stale_reference, broken_dependency, missing_external, boundary_violation, nesting_depth

// Composite types
HubGraph; // hub + all resolved spokes + edges + violations
```

**Tests** (`tests/graph/types.test.ts`):

- Construction: create each type with valid data
- Serialization: JSON roundtrip for all types
- ViolationKind exhaustiveness

**Acceptance**: All primitive types defined. Tests pass.

---

### Step 2: Constitution Parser (`src/graph/parser.ts`)

Parse CONSTITUTION.md files into `Constitution` structs. The **directory semantics table** is the canonical source of structural declarations. ASCII trees are illustrative — parsed for cross-reference but not authoritative.

**Function**: `parseConstitution(filePath: string): Promise<Constitution>`

Extraction targets:
| Section | Extraction | Maps to |
|---------|-----------|---------|
| `## Purpose` | First paragraph | `constitution.purpose` |
| Directory semantics table | Table rows: path, description | `constitution.tree: DeclaredNode[]` |
| `## Entry Points` table | Table rows: command, description | `constitution.entryPoints: EntryPoint[]` |
| `## Dependencies` | List items or table rows | `constitution.dependencies: Dependency[]` |
| `## Boundaries` / `## Confidentiality` | Boundary declarations | `constitution.boundaries: Boundary[]` |
| Spoke charters table | Table rows: spoke name, purpose, governance | `constitution.spokes: SpokeDeclaration[]` |

**Key difference from current `extractClaims()`**: No backtick mining. Only structured table/list extraction. The parser knows what it's looking for and where.

**Reuse**: The existing `navigation/constitution-index.ts` already has `extractPurpose()`, `extractEntryPoints()`, `extractDirectorySemantics()`. These can be refactored into shared helpers or the graph parser can supersede them.

**Tests** (`tests/graph/parser.test.ts`):

- Parse mgmt's root CONSTITUTION.md → verify spoke count, entry points, purpose
- Parse contexgin's CONSTITUTION.md → verify directory tree, boundaries
- Parse centaur's CONSTITUTION.md → verify entry points, dependencies
- Parse mitzo's CONSTITUTION.md → verify structure
- Malformed input: missing sections, empty tables, no frontmatter
- Table format variations: with/without leading pipes, varying column counts
- Spoke charters extraction: name, purpose, governance, confidentiality

**Fixtures**: Copy sanitized CONSTITUTION.md files from mgmt, centaur, contexgin, mitzo into `tests/fixtures/constitutions/`.

**Acceptance**: All real constitutions parse without errors. Extracted data matches manual inspection.

---

### Step 3: `.centaurignore` Support (`src/graph/ignore.ts`)

Gitignore-syntax exclusion files at hub roots. Patterns exclude paths from structural validation (they're known noise, not violations).

**Functions**:

- `loadIgnorePatterns(hubRoot: string): IgnorePatterns`
- `shouldIgnore(path: string, patterns: IgnorePatterns): boolean`

Use Node.js `ignore` package (add as dependency) or implement minimal gitignore glob matching. The `ignore` npm package is battle-tested and tiny — prefer it over hand-rolling.

**Default ignores** (even without a `.centaurignore` file):

```
.git/
node_modules/
__pycache__/
*.pyc
.venv/
dist/
.claude/
```

**Tests** (`tests/graph/ignore.test.ts`):

- Load patterns from file
- Default patterns applied when no file exists
- Glob matching: wildcards, directory patterns, negation
- Path normalization (trailing slashes, relative paths)

**Acceptance**: `.centaurignore` at hub root is respected during validation. Default patterns exclude common noise.

---

### Step 4: Graph Builder (`src/graph/builder.ts`)

Construct a `HubGraph` from a filesystem root by parsing constitutions and assembling the topology.

**Function**: `buildGraph(roots: string[]): Promise<HubGraph>`

**Algorithm**:

```
For each root:
  1. Load .centaurignore → build exclusion set
  2. Read root CONSTITUTION.md → parseConstitution()
  3. Create Hub node
  4. Extract spoke charters → for each spoke:
     a. Check spoke directory exists
     b. Read spoke/CONSTITUTION.md → parseConstitution()
     c. Create Spoke node
     d. Create 'contains' Dependency edge (hub → spoke)
  5. Extract dependencies from all constitutions → create typed edges
  6. Extract boundaries → annotate spoke nodes
  7. Resolve [external] references → create 'external' edges (resolved later in multi-hub)
  8. Return HubGraph { hub, spokes, edges, externals }
```

**Handling missing constitutions**: If a spoke directory exists but has no CONSTITUTION.md, create the spoke node anyway and record a `missing_constitution` violation. The graph is constructed from what exists; violations report what's wrong.

**Tests** (`tests/graph/builder.test.ts`):

- Build graph from test fixture workspace → verify hub, spokes, edges
- Build graph from real mgmt workspace → verify spoke count matches known value
- Missing spoke constitution → violation produced, graph still builds
- Missing spoke directory → violation produced
- External references recorded but not resolved (single-hub mode)
- Empty workspace (no constitutions) → empty graph, no crash

**Acceptance**: `buildGraph(['~/redhat/mgmt'])` produces a HubGraph with correct topology. All spokes present. Dependencies typed correctly.

---

### Step 5: Graph Queries (`src/graph/query.ts`)

Query operations on the built graph. These power validation and will later power the daemon API.

**Functions**:

- `resolveReference(graph: HubGraph, fromSpoke: string, ref: string): ResolvedPath | null`
  - Check child of current spoke → sibling spoke → hub root → external
  - Returns absolute path if found, null if unresolvable
- `traverseDependencies(graph: HubGraph, spokeId: string): Spoke[]`
  - Follow dependency edges, return all transitive dependencies
  - Detect cycles (return cycle path as violation, don't infinite loop)
- `isAccessible(graph: HubGraph, fromSpoke: string, toSpoke: string): boolean`
  - Check boundary constraints between spokes
- `findSpoke(graph: HubGraph, name: string): Spoke | null`
  - Lookup by name or path
- `getExternals(graph: HubGraph): ExternalRef[]`
  - All unresolved external references

**Tests** (`tests/graph/query.test.ts`):

- Reference resolution: spoke-relative, sibling-spoke, hub-root
- Reference resolution: unresolvable path → null
- Dependency traversal: direct, transitive, with cycle detection
- Access check: no boundary → accessible, hard boundary → not accessible
- Spoke lookup: by name, by path, missing → null

**Acceptance**: All query functions work against the mgmt graph. Reference resolution handles the cross-spoke cases that caused false positives.

---

### Step 6: Graph-Aware Validation (`src/graph/validate.ts`)

Replace prose-mining validation with graph-aware structural and relational checks.

**Function**: `validateGraph(graph: HubGraph, roots: string[]): Violation[]`

**Level 1 — Structural** (filesystem checks):

- Declared directories exist on disk
- Declared files exist on disk
- No undeclared directories in spoke roots (respecting `.centaurignore`)
- All spokes have constitutions
- Nesting depth ≤ 2

**Level 2 — Relational** (graph checks):

- Dependencies resolve to existing spokes/hubs
- External references point to real directories with constitutions
- Boundaries are consistent (no circular exclusions)
- Entry points are callable (file exists, or command is a known pattern like `./mgmt <subcommand>`)
- Cross-spoke references resolve via `resolveReference()`

**Violation output**: Each violation has kind, severity, location, declared vs actual, source file, human-readable message, and optional fix suggestion.

**Relationship to existing integrity module**: The existing `claims.ts` + `validator.ts` continue to work for backward compatibility. `validateGraph()` is the new recommended API. Once validated against real data, the old claim-based validation can be deprecated.

**Tests** (`tests/graph/validate.test.ts`):

- Level 1: missing directory → violation, present directory → no violation
- Level 1: undeclared directory (not in .centaurignore) → warning violation
- Level 1: undeclared directory (in .centaurignore) → no violation
- Level 1: missing constitution → violation
- Level 2: broken dependency → violation
- Level 2: valid dependency → no violation
- Level 2: missing external → violation
- Level 2: entry point exists → no violation
- Level 2: entry point with args (e.g. `./mgmt refresh`) → validated correctly
- Integration: run against mgmt workspace → zero false positives

**The critical test**: Run `validateGraph()` against `~/redhat/mgmt` and compare results to the 162 false positives from the old claim-based system. Every former false positive should be either:

- Correctly resolved (no longer a violation), or
- Correctly reclassified (real violation with proper context)

**Acceptance**: Zero false positives on mgmt. All violations are actionable. Each violation has a clear message and suggestion.

---

### Step 7: Public API + Exports (`src/graph/index.ts`, `src/index.ts`)

Export the graph module's public API:

```typescript
// src/graph/index.ts
export { parseConstitution } from './parser.js';
export { buildGraph } from './builder.js';
export { resolveReference, traverseDependencies, isAccessible, findSpoke } from './query.js';
export { validateGraph } from './validate.js';
export { loadIgnorePatterns, shouldIgnore } from './ignore.js';
export type {
  Hub,
  Spoke,
  Constitution,
  Dependency,
  Boundary,
  EntryPoint,
  Violation,
  HubGraph,
} from './types.js';
```

Add to `src/index.ts` barrel export.

**Tests**: Import from package root, verify all public types and functions are accessible.

**Acceptance**: `import { buildGraph, validateGraph } from 'contexgin'` works.

---

### Step 8: CLI Entry Point (`src/cli.ts` or `bin/contexgin`)

Simple CLI for running validation from the command line. Not a daemon — just a one-shot command.

```bash
npx contexgin validate ~/redhat/mgmt
npx contexgin validate ~/redhat/mgmt ~/projects
npx contexgin graph ~/redhat/mgmt          # print graph summary
```

**Output format**: Clean, actionable terminal output. Group violations by spoke, color by severity (error=red, warning=yellow, info=dim). Summary line at the end.

```
~/redhat/mgmt (15 spokes, 23 dependencies)

  career/
    ⚠ undeclared_directory: career/archive/ — not in constitution, not in .centaurignore

  command_center/
    ✓ clean

  ...

Summary: 3 errors, 5 warnings, 2 info — 15 spokes validated
```

**Tests**: Snapshot tests for CLI output formatting (mock filesystem, verify output string).

**Acceptance**: `npx contexgin validate ~/redhat/mgmt` runs and produces clean output with zero false positives.

---

## Execution Order

Steps 1-3 have no dependencies on each other and can be built in parallel if desired. Steps 4-6 are sequential (builder needs parser + ignore, validation needs builder + queries). Steps 7-8 are final wiring.

```
Step 1 (types) ──────┐
Step 2 (parser) ─────┼──→ Step 4 (builder) ──→ Step 5 (queries) ──→ Step 6 (validate) ──→ Step 7 (exports) ──→ Step 8 (CLI)
Step 3 (ignore) ─────┘
```

Each step is a commit. Each commit includes implementation + tests.

---

## What This Doesn't Do (Yet)

- **Daemon mode** — Phase 2 (file watching, HTTP/socket server, persistence)
- **Multi-hub meta-graph** — `buildGraph()` accepts multiple roots and builds per-hub, but cross-hub edge resolution is Phase 2
- **Context compilation integration** — compiler module continues to work independently; graph-aware compilation is Phase 2
- **Level 3 (semantic) validation** — needs LLM, deferred to post-daemon
- **Rust port** — Phase 5, after TS is validated
- **Spoke scaffolding** — `createSpoke()` API, deferred to Phase 2

## Dependencies to Add

- `ignore` — gitignore pattern matching (~50KB, zero transitive deps)
- Optional: `chalk` or `picocolors` for CLI color output (picocolors preferred — 2KB, zero deps)

---

## Success Criteria

1. `npm test` — all existing tests still pass (no regressions)
2. `npm test` — all new graph tests pass (14+ new test files)
3. `npx contexgin validate ~/redhat/mgmt` — zero false positives
4. `npx contexgin validate ~/projects` — runs cleanly
5. Every violation is actionable (has message + suggestion)
6. Graph construction time < 1s for mgmt workspace
