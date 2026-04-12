# Acme Workspace

## Purpose

A multi-spoke workspace for testing parser format variations.

## Principles

### 1. Tests Come First

All changes require tests.

### 2. Keep It Simple

Prefer clarity over cleverness.

### 3. Boundaries Matter

Respect spoke confidentiality.

## Spoke Charters

| Sub-Repo    | Audience  | Governance       | Purpose                |
| ----------- | --------- | ---------------- | ---------------------- |
| `api/`      | Engineers | Own constitution | REST API layer         |
| `auth/`     | Engineers | Own constitution | Authentication service |
| `cli/`      | Engineers | Shared           | Command-line interface |
| `docs/`     | Everyone  | Shared           | Documentation site     |
| `internal/` | Core team | Own constitution | Internal tools         |
| `lib/`      | Engineers | Shared           | Shared utilities       |

## Entry Points

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `./run`             | Interactive CLI with subcommand menu |
| `./run serve`       | Start the API server                 |
| `./run test`        | Run all tests                        |
| `scripts/deploy.sh` | Deploy to production                 |
| `GET /health`       | Health check endpoint                |
| `POST /api/v1/data` | Data ingestion endpoint              |
| `compile()`         | Main compiler function               |

## Directory Semantics

| Path           | What belongs here        | What doesn't     |
| -------------- | ------------------------ | ---------------- |
| `acme/` (root) | This constitution        | Data files       |
| `scripts/`     | Build and deploy scripts | Application code |
| `config/`      | Pipeline settings        | Credentials      |
| `.github/`     | CI/CD workflows          | Source code      |

## Dependencies

| Dependency | Purpose            |
| ---------- | ------------------ |
| `postgres` | Primary data store |
| `redis`    | Cache layer        |
