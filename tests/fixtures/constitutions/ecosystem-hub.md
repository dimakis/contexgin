# Ecosystem

## Purpose

A multi-project ecosystem hub with entry points and dependencies.

## Spoke Charters

| Spoke       | Function   | Input        | Process           | Output    |
| ----------- | ---------- | ------------ | ----------------- | --------- |
| `frontend/` | Web UI     | User actions | Render → Interact | Pages     |
| `backend/`  | API server | Requests     | Route → Process   | Responses |
| `shared/`   | Common lib | Types        | Compile           | Exports   |

## Entry Points

| Command             | Description             |
| ------------------- | ----------------------- |
| `./start.sh`        | Start all services      |
| `./start.sh --dev`  | Start in dev mode       |
| `docker compose up` | Container orchestration |

## Directory Semantics

| Path        | What belongs here     |
| ----------- | --------------------- |
| `packages/` | Monorepo packages     |
| `tools/`    | Build tooling         |
| `docs/`     | Project documentation |
