# Internal Tools

## Purpose

Internal tooling and automation scripts for the core team.

## Directory Semantics

| Path          | What belongs here  |
| ------------- | ------------------ |
| `src/`        | Source code        |
| `scripts/`    | Automation scripts |
| `config.yaml` | Tool configuration |

## Entry Points

| Command         | Description        |
| --------------- | ------------------ |
| `./internal.sh` | Run internal tools |

## Dependencies

| Dependency | Purpose                |
| ---------- | ---------------------- |
| `auth/`    | Needs token validation |
| `lib/`     | Shared utilities       |
| `api/`     | Reads for status data  |

## Confidentiality

- Never flows into `docs/`
- Never appears in public reports
- Internal data never leaves this directory
