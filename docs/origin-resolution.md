# Origin Resolution

Origin resolution determines what _additional_ context to inject based on how a session was triggered. An agent compiling context for an interactive chat gets different hints than one triggered by a Telos task or a calendar event.

## Concept

Every agent session has an **origin** -- the trigger that started it. Most sessions are interactive chat (the default). But when a session is triggered by a specific event (a task item, a calendar meeting, a file being edited), the origin resolver can inject task-relevant context without the user explicitly requesting it.

```
Session origin metadata        Origin resolver         Resolved manifest
┌───────────────────┐      ┌─────────────────┐      ┌──────────────────┐
│ source: "telos"   │─────►│ telosResolver   │─────►│ taskHint: "..."  │
│ entityId: "abc123"│      │                 │      │ excluded: [...]  │
└───────────────────┘      └─────────────────┘      └──────────────────┘
                                                            │
                                                            ▼
                                                   Merged with agent
                                                   definition defaults
                                                            │
                                                            ▼
                                                   Compiler produces
                                                   context payload
```

## Available Resolvers

### Chat Resolver

**Source:** `chat`
**Trigger:** Interactive chat session (default)
**Behavior:** No-op. Returns an empty manifest. Agent definition defaults are used as-is.

This is the baseline -- when no origin is specified, the chat resolver handles it.

### Telos Resolver

**Source:** `telos`
**Trigger:** Telos task item
**Behavior:** Injects the task's description as a `taskHint`, which boosts relevance of matching context sections during compilation.

```bash
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=telos&origin.entityId=abc123'
```

When `entityId` is provided, the resolver looks up the Telos item and uses its title/description to construct a task hint. This surfaces context sections that are relevant to the specific task being worked on.

### Calendar Resolver

**Source:** `calendar`
**Trigger:** Calendar event
**Behavior:** Adds meeting-relevant context based on the event metadata.

```bash
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=calendar&origin.entityId=event-456'
```

When `entityId` is provided, the resolver uses the calendar event's title and attendees to construct context hints. This is useful for meeting prep scenarios where the agent needs context about the topics and people involved.

### File Resolver

**Source:** `file`
**Trigger:** File opened or being edited
**Behavior:** Scopes context to the file's spoke within the workspace.

```bash
curl 'http://127.0.0.1:4195/api/agents/workspace-assistant/context?origin.source=file&origin.entityId=src/server/app.ts'
```

When `entityId` contains a file path, the resolver identifies which spoke the file belongs to and injects a task hint scoped to that spoke. This surfaces spoke-specific conventions and architecture without requiring the user to specify the scope manually.

## Resolved Manifest

Each resolver returns a `ResolvedManifest`:

```typescript
interface ResolvedManifest {
  /** Additional context sources to compile */
  sources?: ContextSource[];

  /** Sections to exclude (merged with agent definition excludes) */
  excluded?: string[][];

  /** Task hint (prepended to agent definition task hint if present) */
  taskHint?: string;
}
```

The manifest is **merged** with the agent definition's defaults:

- `sources` -- added alongside the definition's default sources
- `excluded` -- merged with the definition's excluded sections
- `taskHint` -- prepended to any existing task hint from the definition

This is additive, not destructive. The origin resolver layers context on top of the base definition.

## Using Origins

### Via API

Pass origin parameters as query strings:

```bash
# Chat (default, no parameters needed)
curl 'http://127.0.0.1:4195/api/agents/my-agent/context'

# Telos task
curl 'http://127.0.0.1:4195/api/agents/my-agent/context?origin.source=telos&origin.entityId=task-123'

# Calendar event
curl 'http://127.0.0.1:4195/api/agents/my-agent/context?origin.source=calendar&origin.entityId=event-456'

# File scope
curl 'http://127.0.0.1:4195/api/agents/my-agent/context?origin.source=file&origin.entityId=src/compiler/index.ts'
```

### Via Library

```typescript
import { compileAgent, loadAgentDefinition } from 'contexgin';

const def = await loadAgentDefinition('.agents/workspace-assistant.yaml');

// With Telos origin
const compiled = await compileAgent(def, '/path/to/workspace', {
  source: 'telos',
  entityId: 'task-123',
});

// With file origin
const compiled = await compileAgent(def, '/path/to/workspace', {
  source: 'file',
  entityId: 'src/server/app.ts',
});
```

## Resolver Interface

```typescript
interface OriginResolver {
  /** Which origin source this resolver handles */
  source: OriginSource;

  /** Whether this resolver can handle the given origin */
  canHandle(origin: SessionOrigin): boolean;

  /**
   * Resolve additional context sources based on origin metadata.
   * @param origin - Session origin metadata
   * @param workspaceRoot - Workspace root directory
   * @param defaultSources - Default sources from agent definition
   * @returns Resolved manifest with additional sources/excludes/hints
   */
  resolve(
    origin: SessionOrigin,
    workspaceRoot: string,
    defaultSources: ContextSource[],
  ): Promise<ResolvedManifest>;
}
```

Resolvers are pure functions: origin metadata in, manifest out. No side effects, no state mutation.

## Types

```typescript
/** Session origin source */
type OriginSource = 'chat' | 'telos' | 'calendar' | 'file';

/** Session origin metadata */
interface SessionOrigin {
  source: OriginSource;
  entityId?: string;
  metadata?: Record<string, unknown>;
}
```
