# ContexLib

## Purpose

A context orchestration library for AI agent harnesses.

## Architecture

| Module         | Responsibility                          |
| -------------- | --------------------------------------- |
| `compiler/`    | Parse and compile context sources       |
| `integrity/`   | Validate structural claims              |
| `navigation/`  | Constitution indexing and reading lists |
| `permissions/` | Access control policies                 |

## Entry Points

| Export          | Description              |
| --------------- | ------------------------ |
| `compile()`     | Main compiler function   |
| `validateAll()` | Run all validators       |
| `buildIndex()`  | Build constitution index |

## Directory Semantics

| Path              | What belongs here |
| ----------------- | ----------------- |
| `src/`            | All source code   |
| `tests/`          | Test files        |
| `CONSTITUTION.md` | This file         |

## Boundaries

- Use caution when sharing module internals externally
- API surface is `src/index.ts` only
