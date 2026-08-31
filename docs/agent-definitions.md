# Agent Definitions

Agent definitions are declarative YAML configs that describe what context an agent should receive, how it should behave, and what provider to use. ContexGin compiles context from these definitions and serves them via the `/api/agents/:name/context` endpoint.

## Where to Put Definitions

Place agent definition files in a `.agents/` directory at your workspace root:

```
~/redhat/mgmt/
├── .agents/
│   ├── pr-reviewer.yaml
│   ├── workspace-assistant.yaml
│   └── doc-linter.yaml
├── CONSTITUTION.md
└── ...
```

The daemon discovers definitions by scanning `.agents/*.yaml` and `.agents/*.yml` files in each configured workspace root. Results are cached for 30 seconds.

## Schema Reference

### Full Schema

```yaml
kind: AgentDefinition

identity:
  name: string # Required. Agent name (used in API paths)
  description: string # Required. What this agent does
  role: string # Optional. Agent role or purpose

provider:
  provider: string # Required. Provider name (anthropic, openai, google, etc.)
  model: string # Required. Model identifier
  temperature: number # Optional. Temperature override
  maxTokens: number # Optional. Max tokens override
  params: object # Optional. Provider-specific parameters

context:
  boot: # Boot context (injected at session start)
    constitution: boolean | string[] # Include CONSTITUTION.md (true/false or specific sections)
    claudeMd: boolean | string[] # Include CLAUDE.md
    profile: boolean | string[] # Include memory/Profile/*.md
    cursorRules: boolean | string[] # Include .cursor/rules/*.mdc
    spokes: boolean # Include spoke-level files (default: true)
    tokenBudget: number # Token budget for boot context

  blocks: # Context blocks (per-message dynamic context) — placeholder, not yet implemented (#14)
    - id: string # Block identifier
      source: string # Source file or pattern
      taskHint: string # Optional task hint for relevance

  operational: # Always-on operational context
    files: # Files to load
      - string
    delivery: string # How to deliver: sdk | alwaysApply | additionalContext

  memory: # Auto-memory behavioral feedback
    enabled: boolean
    path: string # Memory directory path
    types: # Memory types to include
      - feedback | user | project | reference

governance:
  forbidden: # Things the agent must never do
    - string
  required: # Things the agent must always do
    - string
  approvalRequired: # Actions requiring human approval
    - string

skills: # Available skills
  - id: string
    description: string
    enabled: boolean

metadata:
  version: string
  updated: string # ISO 8601 timestamp
  author: string
  tags:
    - string
```

### Required Fields

Only three fields are strictly required:

- `identity.name` -- must be unique across all definitions
- `identity.description` -- what the agent does
- `provider.provider` and `provider.model` -- which LLM to use

Everything else has sensible defaults.

## Examples

### Narrow Agent: PR Reviewer

A focused, single-purpose agent with static context. Every session compiles the same payload. No memory persistence.

```yaml
kind: AgentDefinition

identity:
  name: pr-reviewer
  description: Reviews PRs against architecture docs and writing guidelines
  role: code-reviewer

provider:
  provider: anthropic
  model: claude-opus-4
  temperature: 0.3

context:
  boot:
    constitution: true
    claudeMd: true
    profile: false
    spokes: true
    tokenBudget: 12000
  operational:
    files:
      - docs/review-criteria.md
      - docs/coding-standards.md
    delivery: additionalContext

governance:
  forbidden:
    - Merge PRs without two reviews
    - Approve PRs that fail CI
  required:
    - Check CI status before approving
    - Verify conventional commit format

metadata:
  version: '1.0'
  author: dimakis
  tags: [review, ci, quality]
```

### Dynamic Agent: Workspace Assistant

A conversational agent with growing context over sessions. Memory scope is read-write. The vault accumulates observations and decisions.

```yaml
kind: AgentDefinition

identity:
  name: workspace-assistant
  description: General-purpose workspace assistant with memory
  role: collaborator

provider:
  provider: anthropic
  model: claude-opus-4
  temperature: 0.7

context:
  boot:
    constitution: true
    claudeMd: true
    profile: true
    cursorRules: true
    spokes: true
    tokenBudget: 12000
  memory:
    enabled: true
    path: memory/
    types: [feedback, user, project, reference]

governance:
  forbidden:
    - Push to main branch
    - Delete files without confirmation
  approvalRequired:
    - Creating PRs
    - Modifying CI configuration

skills:
  - id: commit
    description: Create git commits
    enabled: true
  - id: pr-lifecycle
    description: Full PR lifecycle management
    enabled: true

metadata:
  version: '1.0'
  author: dimakis
  tags: [general, memory, interactive]
```

### Minimal Agent: Doc Linter

The simplest possible definition. Only requires identity and provider.

```yaml
kind: AgentDefinition

identity:
  name: doc-linter
  description: Checks documentation for consistency and completeness

provider:
  provider: anthropic
  model: claude-sonnet-4-6
```

## Boot Context Configuration

The `context.boot` section controls what sources are compiled into the agent's boot payload.

### Source Toggles

Each source type can be:

- `true` -- include all content from this source
- `false` -- exclude entirely
- `string[]` -- include only specific sections (matched by heading path)

```yaml
context:
  boot:
    constitution: true # Include all of CONSTITUTION.md
    claudeMd: # Include only specific CLAUDE.md sections
      - Git Discipline
      - Entry Points
    profile: false # Exclude memory/Profile/*
    cursorRules: true # Include .cursor/rules/*.mdc
    spokes: false # Exclude spoke-level files
    tokenBudget: 8000 # Lower budget for focused agents
```

### Token Budget

The `tokenBudget` sets a hard ceiling on the boot payload size. The compiler will rank and trim sections to fit within this budget. Default is 12,000 tokens if not specified.

Lower budgets produce more focused payloads (less context, faster responses). Higher budgets include more context but risk diluting the signal. The sweet spot depends on the agent's purpose:

- Narrow agents (PR reviewer): 6,000-10,000 tokens
- General assistants: 10,000-15,000 tokens
- Deep-context agents: 15,000-20,000 tokens

### Spoke Inclusion

When `spokes: true` (default), the compiler includes spoke-level CONSTITUTION.md files alongside the hub-level content. Spoke content receives a 0.35 relevance penalty -- it's context, not instructions. Set `spokes: false` for agents that only need hub-level governance.

## Operational Context

Files listed under `context.operational` are loaded and served alongside the boot context but delivered through a different mechanism:

| Delivery            | How It Works                                               |
| ------------------- | ---------------------------------------------------------- |
| `sdk`               | Injected via the SDK's native context mechanism            |
| `alwaysApply`       | Applied to every turn (Cursor-style)                       |
| `additionalContext` | Added as supplementary context alongside the system prompt |

```yaml
context:
  operational:
    files:
      - docs/review-criteria.md
      - .github/CODEOWNERS
    delivery: additionalContext
```

## Memory Configuration

When `context.memory.enabled` is true, the compiler loads auto-memory files and includes relevant entries in the agent's context.

```yaml
context:
  memory:
    enabled: true
    path: memory/ # Relative to workspace root
    types:
      - feedback # How the user wants to work
      - user # User profile information
      - project # Ongoing project context
      - reference # External resource pointers
```

This is what makes a dynamic agent -- it accumulates knowledge over sessions. A narrow agent should set `memory.enabled: false` (or omit the section entirely).

## Governance

Governance rules are injected into the agent's context as behavioral constraints. They are enforced at the context level (strong nudge) but ultimately depend on model compliance.

```yaml
governance:
  forbidden:
    - Push directly to main branch
    - Delete production data
    - Skip pre-commit hooks
  required:
    - Run tests before committing
    - Use conventional commit messages
  approvalRequired:
    - Creating pull requests
    - Modifying CI/CD pipelines
    - Deleting branches
```

**Enforcement reality:** Boundary restrictions (`forbidden`) are enforceable at both the compiler level (won't include inaccessible content from hard-boundary spokes) and the harness level (can reject tool calls). Output conventions and behavioral rules are injected as context -- a strong nudge, not a runtime guarantee. LLMs can drift past injected instructions. The schema acknowledges this gap rather than pretending it's solved.

## Origin-Aware Compilation

When the `/api/agents/:name/context` endpoint receives origin parameters, the origin resolver modifies the compilation:

```bash
# Default (chat origin -- no modifications)
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context'

# Telos origin -- task description injected as task hint
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=telos&origin.entityId=abc123'

# File origin -- context scoped to the file's spoke
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=file&origin.entityId=src/server/app.ts'
```

The origin resolver's manifest is **merged** with the agent definition's defaults. Origin-provided hints and exclusions layer on top of, not replace, the base definition.

See [origin-resolution.md](origin-resolution.md) for the full resolver system.

## API Usage

### List Available Agents

```bash
curl http://127.0.0.1:4195/api/agents
```

### Compile Agent Context

```bash
curl 'http://127.0.0.1:4195/api/agents/pr-reviewer/context'
```

### Use in a Harness

```typescript
const res = await fetch('http://127.0.0.1:4195/api/agents/pr-reviewer/context');
const compiled = await res.json();

// compiled.boot.content -- inject as system prompt
// compiled.governance -- apply as behavioral constraints
// compiled.operational.files -- load as additional context
// compiled.provider -- use as model configuration
```

## Validation

`loadAgentDefinition(filePath)` validates the YAML against the expected shape. It checks:

- `identity.name` and `identity.description` are present
- `provider.provider` and `provider.model` are present
- All enum fields use valid values
- Array fields contain the correct types

Invalid definitions log a warning and are skipped during discovery.

## Library Usage

```typescript
import { loadAgentDefinition, compileAgent } from 'contexgin';

// Load a single definition
const def = await loadAgentDefinition('/path/to/.agents/pr-reviewer.yaml');

// Compile context for it
const compiled = await compileAgent(def, '/path/to/workspace');

// With origin
const compiledWithOrigin = await compileAgent(def, '/path/to/workspace', {
  source: 'telos',
  entityId: 'task-123',
});

console.log(compiled.bootContext.content); // Compiled payload
console.log(compiled.bootContext.tokens); // Token count
console.log(compiled.governance); // Governance rules
```
