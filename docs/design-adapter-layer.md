# Design Idea: Context Adapter Layer

**Status:** Thought
**Date:** 2026-04-13
**Origin:** Conversation about bridging Centaur/ContexGin with Cogenti platform deployment on OpenShift

## Problem

Every AI coding tool writes context to its own format:

- Claude Code → `CLAUDE.md`
- Cursor → `.cursor/rules/`
- ContexGin → `CONSTITUTION.md`
- Most projects → `README.md`, `pyproject.toml`, etc.

If ContexGin only reads constitutions, it misses the majority of existing context that teams already maintain. The platform story ("context is infrastructure") breaks when the infrastructure only speaks one format.

For Cogenti on OpenShift, this is a blocker: you can't tell teams to rewrite all their docs as constitutions before onboarding.

## Proposal: Adapter Layer

ContexGin should normalize heterogeneous context sources into a unified internal model, the same way Kubernetes accepts Raw YAML, Helm, Kustomize, and CDK8s but compiles them all into the same runtime objects.

### Architecture

```
Input Sources          Adapters                 Internal Model         Output
─────────────         ─────────               ──────────────         ──────
CLAUDE.md        ──▶  claude_adapter      ──▶                   ──▶  Claude payload
.cursor/rules/   ──▶  cursor_adapter      ──▶  Normalized        ──▶  Cursor rules
CONSTITUTION.md  ──▶  constitution_adapter ──▶  Context Graph     ──▶  Generic LLM
README.md        ──▶  markdown_adapter    ──▶                   ──▶  OpenAI format
pyproject.toml   ──▶  project_adapter     ──▶                   ──▶  ...
```

Each adapter does three things:

1. **Parse** — extract structured context from the source format
2. **Classify** — assign type (structural, operational, identity, governance) and tier
3. **Normalize** — emit internal context nodes with metadata

The compiler works on normalized nodes only. It never sees the source format.

### Adapter Placement: Core + Sidecar

Two deployment models, not mutually exclusive:

- **Core adapters (baked in)** — for universal formats: CLAUDE.md, .cursor/rules, CONSTITUTION.md, README. These change slowly and everyone needs them. Ships with ContexGin.
- **Sidecar adapters (external)** — for team-specific or proprietary sources: Confluence, Google Docs, Jira project configs, Slack channels. Deployed independently as containers. Teams can write custom adapters without waiting for a ContexGin release.

Same pattern as K8s admission webhooks: built-in ones for common cases, deploy-your-own for everything else.

### Ingest API Contract

Sidecar adapters push normalized nodes to ContexGin via a standard API:

```
POST /api/context/ingest
{
  "source": "confluence-adapter",
  "nodes": [
    {
      "id": "arch-overview",
      "type": "structural",
      "tier": "navigational",
      "content": "...",
      "metadata": {
        "origin": "confluence://space/ENG/page/12345",
        "freshness": "2026-04-13T09:00:00Z"
      }
    }
  ]
}
```

Adapters push. ContexGin stores, indexes, compiles. Clean boundary.

### Context Node Types

Each normalized node carries:

- **id** — unique identifier within the source
- **type** — structural, operational, identity, governance, reference
- **tier** — constitutional, navigational, identity, reference, historical (existing ContexGin ranking)
- **content** — the actual context text
- **metadata.origin** — URI pointing back to the source (file path, URL, etc.)
- **metadata.freshness** — when the source was last verified current

## Maturity Model

This enables a progressive onboarding path for Cogenti:

| Level | What teams provide                | What they get                                                      |
| ----- | --------------------------------- | ------------------------------------------------------------------ |
| **0** | READMEs, existing docs            | Basic context compilation (adapter extracts what it can)           |
| **1** | CLAUDE.md / .cursor/rules         | Richer operational context                                         |
| **2** | Constitutions                     | Full structural contracts, governance, boundaries, drift detection |
| **3** | Agent definitions + memory vaults | Dynamic agents, compound learning                                  |

Nobody starts at Level 3. The platform works at every level, just improves as you invest.

## Kubernetes / Cogenti Mapping

| Kubernetes                          | ContexGin                                            |
| ----------------------------------- | ---------------------------------------------------- |
| Raw YAML / Helm / Kustomize / CDK8s | CLAUDE.md / .cursor/rules / CONSTITUTION.md / README |
| API Server                          | ContexGin daemon                                     |
| Internal objects (Pod, Service)     | Normalized context nodes                             |
| Namespaces                          | Hubs / Spokes                                        |
| Labels + selectors                  | Relevance tags for compilation                       |
| Admission webhooks                  | Structural validation (drift detection)              |
| CRDs                                | Agent definitions                                    |
| Controllers                         | Adapters that watch + reconcile                      |

### Agent Definition as CRD

```yaml
apiVersion: contexgin.io/v1
kind: AgentDefinition
metadata:
  name: rfe-analyst
  namespace: engineering # ← hub
spec:
  context:
    sources:
      - type: constitution
        path: architecture/
      - type: claude_md
        path: ./CLAUDE.md
      - type: readme
        path: jira_process/README.md
    budget: 12000
  governance:
    boundaries:
      - spoke: career
        access: none
  memory:
    scope: read-write
```

The operator watches these, tells ContexGin to compile, and the harness boots agents with the result.

## Broader Context: Why Not LangGraph

LangGraph/LangChain agents embed orchestration in code — the graph IS the agent. Splitting a graph into microservices on OpenShift means shared state, complex routing, and developers who need to learn both the framework and the deployment topology.

The adapter layer model separates three concerns that graph frameworks tangle:

1. **What the agent knows** → context compilation (ContexGin)
2. **What the agent can do** → tool registry (each tool is naturally a microservice)
3. **How the agent runs** → harness/runtime (lifecycle, permissions, human-in-loop)

The onboarding story becomes: "write a YAML definition, point at your context sources, deploy." No graph to author, no framework to learn.

## Platform Integration: ContexGin as Init Layer

ContexGin is not orchestration. It's a **pre-boot step** — an init container, not a sidecar.

### Lifecycle

```
Agent definition (CRD) created
        │
        ▼
ContexGin compiles context for this agent
        │  (reads sources via adapters)
        │  (ranks, trims to budget)
        │  (validates structural claims)
        │
        ▼
Compiled payload injected as system prompt / env
        │
        ▼
Platform starts the agent container
        │  (OpenClaw claw / Cogenti workload)
        │
        ▼
Agent runs with full context from first token
```

No ongoing coupling. ContexGin runs before the agent boots, produces a context payload, and gets out of the way.

### OpenClaw Integration

- Each claw definition gets a `context` field pointing at sources
- Platform calls ContexGin API to compile before starting the claw
- Payload goes in as system prompt or mounted config
- ContexGin is an optional init step — claws get smarter without changing their code

### Cogenti Differentiation

Without ContexGin, both OpenClaw and Cogenti are **dumb runtimes** — they run agents but don't help them be smarter. Every agent discovers its own context at runtime, burning tokens.

With ContexGin as a native platform service, Cogenti becomes **context-aware**: agents boot pre-compiled with the right context. That's the value-add over OpenClaw — not just "deploy agents on OpenShift" but "deploy agents that already know what they need to know."

### Agent Category Mapping

Three categories of "agents" exist — ContexGin helps all of them:

| Category      | Examples                              | What it provides                         | ContexGin role                                |
| ------------- | ------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| **Framework** | LangGraph, LangChain, CrewAI, AutoGen | Orchestration logic (graph/chain)        | Compile context for each node's LLM call      |
| **Harness**   | Claude Code, Codex, Devin, Cline      | Runtime environment (tools, permissions) | Compile boot payload for autonomous decisions |
| **Platform**  | OpenClaw, Cogenti                     | Deployment + lifecycle on K8s            | Init container — compile before agent starts  |

ContexGin is orthogonal to all three. It's infrastructure, not a framework or a harness.

### Benchmark Grid

To prove the value, test across categories:

|                           | No context | ContexGin compiled                           |
| ------------------------- | ---------- | -------------------------------------------- |
| **LangGraph** (framework) | Baseline   | Does context help a scripted agent?          |
| **Claude Code** (harness) | Baseline   | Does context help an autonomous agent?       |
| **OpenClaw** (platform)   | Baseline   | Does context help a platform-deployed agent? |

If ContexGin reduces tokens-to-goal across all three, the pitch is: **context compilation is orthogonal to how you build or deploy agents.**

Benchmark tasks (ordered by wiring effort):

1. **PR review agent** — direct quality comparison, easy to ground-truth
2. **Bug localization** — given a bug report, find the right files. Test at three context levels (none / Level 0 adapter-ingested / Level 2 constitutions) to prove the maturity model
3. **Codebase Q&A** — 10 architecture questions, measure tokens + accuracy. Zero setup.
4. **Non-SWE task** (compliance audit or RFP response) — proves the pattern is domain-agnostic

## Open Questions

- **Adapter discovery** — how does ContexGin know which sidecar adapters are available? Service registry? Convention?
- **Staleness** — how often do sidecar adapters re-push? Watch-based (like K8s controllers) or poll?
- **Conflict resolution** — if CLAUDE.md and CONSTITUTION.md say contradictory things about the same scope, which wins? (Probably: constitution > operational, with a drift warning.)
- **Output adapters** — the diagram shows output formatting per consumer. Is that also pluggable, or is it a fixed set?
- **Multi-tenant isolation** — in Cogenti, how do adapter-pushed nodes respect namespace/hub boundaries?
- **Init vs sidecar trade-off** — init container means context is static for the agent's lifetime. Should there be a refresh mechanism for long-running agents, or is recompile-on-restart sufficient?
- **OpenClaw integration surface** — what's the minimal API contract for OpenClaw to call ContexGin as an init step? Is a single `/compile` endpoint enough?
