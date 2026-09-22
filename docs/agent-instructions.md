# Project instructions in the compiler

`AGENTS.md` is the canonical project instruction source. The adapter reads its
complete text as one required node (`origin.format: agents_md`, `required: true`),
including text before headings and reference lines. It does not reinterpret the
file as optional knowledge. Empty, unreadable, or symlinked canonical files fail
compilation rather than falling back silently.

## Precedence and migration

At each discovered directory, an existing `AGENTS.md` replaces the entire
`CLAUDE.md` compiler source. This is file-level precedence: even distinct sections
in CLAUDE are omitted. Move all shared guidance into AGENTS before adopting this
layout. CLAUDE-only directories retain the existing Claude adapter behavior.
An ignored AGENTS file does not resurrect CLAUDE. Explicit source lists apply the
same precedence when both paths are supplied, and repeated absolute paths are
read once. Pre-adapted `nodes` are caller-owned; their scope and deduplication are
the caller's responsibility.

A thin CLAUDE file containing `@AGENTS.md` works because the compiler reads AGENTS
directly. No `@` imports are expanded, including repeated, cyclic, absolute, or
parent-directory references. Import-looking text in AGENTS is preserved literally.
This contract does not emulate native Claude or Codex discovery.

## Scope

`compile({ workspaceRoot, scopePath: 'app/deep', tokenBudget })` loads project
instructions from the root and each ancestor directory through `app/deep`, in that
order. `scopePath` is a directory, relative to the root or absolute inside it;
`'.'` selects root instructions only. Sibling instruction files are excluded.
Scope directories must exist and may not traverse symlinks or leave the workspace.
Canonical files also reject symlinks in all path components below the root.

For backward compatibility, omitting `scopePath` retains workspace-wide discovery:
root instructions plus instructions in each visible, non-ignored immediate child
directory. It is **not** task-specific scope. Harnesses should supply the actual
working directory explicitly. Ordinary constitution, profile, Cursor-rule, and
knowledge discovery remains unchanged and is still ranked by tier and task hint.
Directory traversal is sorted for repeatable results. `.centaurignore` remains an
explicit exclusion mechanism.

## Required guidance and budgets

Canonical instruction nodes are admitted before optional knowledge. If required
nodes cannot fit, compilation throws with the budget, required token estimate,
and source paths; it does not emit a partial instruction file. Increase the budget
or shorten the canonical guidance. `required` selectors also work for legacy and
knowledge nodes, matching a case-insensitive heading prefix or a single node ID.
Missing or excluded explicit required selectors are errors. Explicit `excluded`
selectors may omit canonical nodes (for example, when a harness deliberately owns
native loading); that harness must verify delivery separately.

Token counts are estimates, not provider billing counts. The serialized node
retains `required` so a subsequent compilation cannot silently drop it. Ordinary
optional nodes retain the existing relevance trimming behavior.

Agent recipes can control canonical instructions with `boot.agentInstructions`.
When that field is omitted, it inherits `boot.claudeMd` so existing recipes keep
the same behavior when a workspace migrates from CLAUDE.md to AGENTS.md.

## Boundaries

This change establishes compiler behavior only. It does not prove native provider
loading, deduplicate native versus injected context, alter any running service,
or migrate existing instruction files. Harness delivery ownership, recipe parity,
provenance inspection, and lifecycle acceptance need separate integration work.
