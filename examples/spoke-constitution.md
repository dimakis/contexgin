# Constitution: My Spoke

<!--
  SPOKE CONSTITUTION TEMPLATE
  ===========================
  This template is for a leaf spoke — a subdirectory within a hub that
  has its own governance. ContexGin parses the same sections as a hub
  but spoke constitutions typically don't have Sub-Repo Charters.

  REQUIRED:
  - Purpose          → extracted as the spoke's purpose string
  - Directory Semantics → parsed as the declared file/directory tree

  RECOMMENDED:
  - Entry Points      → parsed as named commands with descriptions
  - Dependencies      → parsed as dependency edges
  - Boundaries        → parsed for confidentiality levels
  - Principles        → parsed as named principles
-->

Date: 2026-01-01
Author: [your name]

## Purpose

<!-- One paragraph. ContexGin extracts the first non-empty line. -->

[Describe what this spoke does, who it serves, and why it exists as a
separate governed unit.]

## Input / Process / Output

<!-- Not parsed by ContexGin, but useful for humans and AI sessions.
     Describes the data flow through this spoke. -->

|             | Description                               |
| ----------- | ----------------------------------------- |
| **Input**   | What data or signals come into this spoke |
| **Process** | What transformations or operations happen |
| **Output**  | What this spoke produces                  |

## Principles

### 1. [First Principle]

[Explain why this principle matters for this spoke.]

### 2. [Second Principle]

[Explain.]

## Directory Semantics

<!-- ContexGin parses this table to build the declared file tree.
     Keep this in sync with actual directory structure — ContexGin
     will flag drift if declared paths don't exist on disk. -->

| Path        | What belongs here           |
| ----------- | --------------------------- |
| `lib/`      | Core library code           |
| `config/`   | Configuration files         |
| `tests/`    | Test files                  |
| `data/`     | Generated data (gitignored) |
| `README.md` | Spoke documentation         |

## Entry Points

| Command                      | Description      |
| ---------------------------- | ---------------- |
| `python3 spoke/main.py`      | Main entry point |
| `python3 spoke/lib/utils.py` | Shared utilities |

## Dependencies

- `pandas` >= 2.0
- `requests` for API access
- `lib/shared_client.py` from `~/path/to/other/repo/` (shared client)

## Boundaries

<!-- Confidentiality level for this spoke.
     Options: none (default), soft (caution), hard (never share).
     ContexGin infers from keywords in this section. -->

- This spoke has no confidentiality boundary — all content is shareable.

## Relationship to Other Spokes

<!-- Not parsed by ContexGin, but useful context for understanding
     how this spoke fits into the larger hub. -->

- **Reads from** `other-spoke/data/` — uses its output as input
- **Does not write to** any other spoke
