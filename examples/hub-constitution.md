# Constitution: My Workspace

<!--
  HUB CONSTITUTION TEMPLATE
  =========================
  This template is for a root workspace (hub) that orchestrates multiple
  sub-repos (spokes). ContexGin parses the following sections:

  REQUIRED:
  - Purpose          → extracted as the hub's purpose string
  - Directory Semantics → parsed as the declared file/directory tree

  RECOMMENDED:
  - Sub-Repo Charters → parsed as spoke declarations (name, purpose, governance)
  - Entry Points      → parsed as named commands with descriptions
  - Dependencies      → parsed as dependency edges (table or bullet list)
  - Boundaries        → parsed for confidentiality levels (hard/soft/none)
  - Principles        → parsed as named principles (sub-heading text)

  The parser extracts from structured sections (tables, lists) — not prose.
  Section heading names are matched case-insensitively and can be at any
  heading level (##, ###, etc.).
-->

## Purpose

<!-- One paragraph describing what this workspace is for.
     ContexGin extracts the first non-empty line after the heading. -->

A hub workspace that orchestrates [describe your domain]. Each subdirectory
is a self-governing spoke with its own constitution, data pipeline, and norms.

## Architecture

### Hub-and-Spoke Model

```
my-workspace/                      <- you are here (hub)
├── spoke-a/                       <- [describe spoke A]
├── spoke-b/                       <- [describe spoke B]
├── spoke-c/                       <- [describe spoke C]
├── shared-lib/                    <- shared utilities
└── docs/                          <- design documents
```

### Sub-Repo Charters

<!-- ContexGin parses this table to discover spokes.
     Column mapping depends on column count:
     - 4 columns: Name | Audience | Governance | Purpose
     - 3 columns: Name | Governance | Purpose
     - 2 columns: Name | Purpose
-->

| Sub-Repo   | Audience | Governance       | Purpose                                 |
| ---------- | -------- | ---------------- | --------------------------------------- |
| `spoke-a/` | Team     | Own constitution | Description of spoke A's responsibility |
| `spoke-b/` | Internal | Own constitution | Description of spoke B's responsibility |
| `spoke-c/` | Public   | README           | Description of spoke C's responsibility |

### External Projects

<!-- Reference projects outside this repo that are part of the ecosystem.
     These are not parsed as spokes but provide useful context. -->

| Project        | Location            | Purpose                         |
| -------------- | ------------------- | ------------------------------- |
| **Other Repo** | `~/projects/other/` | What it does and how it relates |

## Directory Semantics

<!-- ContexGin parses this table to build the declared file tree.
     Each row becomes a DeclaredNode with path, name, type, and description.
     Paths ending in / are directories; others are files.
     Backtick-wrapped paths are automatically stripped. -->

| Path              | What belongs here                             |
| ----------------- | --------------------------------------------- |
| `spoke-a/`        | [what this directory contains]                |
| `spoke-b/`        | [what this directory contains]                |
| `shared-lib/`     | Shared utilities used across spokes           |
| `docs/`           | Design documents and architecture discussions |
| `CONSTITUTION.md` | This file — workspace governance              |
| `CLAUDE.md`       | AI session instructions                       |

## Principles

<!-- ContexGin extracts sub-heading text as principle names.
     Add as many as needed. The prose under each heading is not parsed
     but provides context for humans and AI sessions. -->

### 1. Separation of Concerns

Each spoke does one thing. Mixing concerns creates confusion.

### 2. Constitution-First

Every new spoke starts with a governance document that defines purpose,
boundaries, and directory semantics.

### 3. Spec Before Implementation

Define what you're building before building it.

## Entry Points

<!-- ContexGin parses this as a table of commands.
     First column = command, second column = description. -->

| Command         | Description          |
| --------------- | -------------------- |
| `./run`         | Main CLI entry point |
| `npm test`      | Run all tests        |
| `npm run build` | Build all modules    |

## Dependencies

<!-- ContexGin parses dependencies as either:
     - A table: first column = target, second column = description
     - A bullet list: first backtick reference per bullet is the target

     Dependencies create edges in the structural graph. -->

- `node` >= 20
- `python` >= 3.12
- `gws` CLI for Google Workspace access

## Boundaries

<!-- ContexGin infers confidentiality levels from keywords:
     - "hard" or "never" → hard boundary
     - "soft" or "caution" → soft boundary
     - Otherwise → none

     Backtick-enclosed spoke references ending in / are parsed as
     excluded-from targets. -->

- `spoke-c/` has a hard confidentiality boundary — nothing leaves this directory
- `spoke-a/` has no confidentiality restrictions
