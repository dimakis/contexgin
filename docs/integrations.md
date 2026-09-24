# Integration Patterns

How to connect ContexGin to AI agent harnesses, CI pipelines, and custom tooling.

## Claude Code

### CLAUDE.md Hook

Add to your project's `CLAUDE.md` to give Claude Code sessions access to compiled context:

```markdown
## Workspace Context

ContexGin daemon runs at http://127.0.0.1:4195. Before starting work:

- `curl http://127.0.0.1:4195/health` -- check for structural errors
- `curl -X POST http://127.0.0.1:4195/compile -H 'Content-Type: application/json' -d '{"spoke":"<spoke>","task":"<your task>"}'` -- get compiled context for the spoke you're working in
```

### SessionStart Hook

For automatic context injection at session start, use a Claude Code `SessionStart` hook that calls the agent context endpoint:

```bash
#!/bin/bash
# .claude/hooks/contexgin-boot.sh
AGENT_NAME="${CONTEXGIN_AGENT:-workspace-assistant}"
RESPONSE=$(curl -s "http://127.0.0.1:4195/api/agents/${AGENT_NAME}/context" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
  CONTEXT=$(echo "$RESPONSE" | jq -r '.boot.content // empty')
  if [ -n "$CONTEXT" ]; then
    echo "{\"additionalContext\": $(echo "$CONTEXT" | jq -Rs .)}"
  fi
fi
```

### Drift Check Hook

Add a pre-commit hook that validates structural integrity:

```bash
#!/bin/bash
# Warn on structural drift before committing constitution changes
CHANGED=$(git diff --cached --name-only | grep -E 'CONSTITUTION\.md|CLAUDE\.md')
if [ -n "$CHANGED" ]; then
  RESULT=$(curl -s -X POST http://127.0.0.1:4195/validate \
    -H 'Content-Type: application/json' -d '{}')
  ERRORS=$(echo "$RESULT" | jq '.summary.errors')
  if [ "$ERRORS" -gt 0 ]; then
    echo "ContexGin: $ERRORS structural errors detected"
    echo "$RESULT" | jq '.violations[] | select(.severity == "error") | .message'
    exit 1
  fi
fi
```

## Cursor

### Cursor Rule (.cursor/rules/)

Create `.cursor/rules/contexgin.mdc`:

```markdown
---
description: ContexGin workspace context
alwaysApply: false
globs: ['**/CONSTITUTION.md', '**/CLAUDE.md']
---

When editing constitution or context files, validate changes:
\`\`\`bash
curl -X POST http://127.0.0.1:4195/validate -H 'Content-Type: application/json' -d '{}'
\`\`\`

Check for structural drift before committing governance changes.
```

### Task-Specific Context

Fetch compiled context for a specific task and inject it:

```markdown
---
description: ContexGin task context
alwaysApply: false
---

When working on a focused task, fetch relevant context:
\`\`\`bash
curl -s -X POST http://127.0.0.1:4195/compile \
 -H 'Content-Type: application/json' \
 -d '{"spoke":"<spoke>","task":"<task description>","budget":8000}'
\`\`\`
```

## Mitzo / Custom Agent Harnesses

### Compile Context at Session Start

```typescript
// Fetch compiled context for an agent
async function getAgentContext(agentName: string, origin?: SessionOrigin) {
  const params = new URLSearchParams();
  if (origin?.source) params.set('origin.source', origin.source);
  if (origin?.entityId) params.set('origin.entityId', origin.entityId);

  const url = `http://127.0.0.1:4195/api/agents/${agentName}/context?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`ContexGin: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

// Usage
const compiled = await getAgentContext('workspace-assistant', {
  source: 'telos',
  entityId: 'task-abc123',
});

// Inject boot context as system prompt
const systemPrompt = compiled.boot.content;

// Apply governance rules
const governance = compiled.governance;

// Use provider config
const model = compiled.provider.model;
```

### Spoke-Specific Context

```typescript
// Compile context for a specific spoke and task
async function getSpokeContext(spoke: string, task: string, budget = 12000) {
  const res = await fetch('http://127.0.0.1:4195/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spoke, task, budget }),
  });

  const { context, tokens, sources, nodes } = await res.json();
  return { context, tokens, sources, nodes };
}

// Example: compile context for a specific fix
const ctx = await getSpokeContext('command_center', 'fix morning briefing calendar parsing');
console.log(`Compiled ${ctx.tokens} tokens from ${ctx.sources} sources`);
```

### Health Monitoring

```typescript
// Monitor workspace health in an agent loop
async function checkWorkspaceHealth(): Promise<boolean> {
  const res = await fetch('http://127.0.0.1:4195/health');
  const health = await res.json();

  if (health.status !== 'ok') {
    console.warn('ContexGin is rebuilding graph');
    return false;
  }

  if (health.violations.errors > 0) {
    console.warn(`Structural drift: ${health.violations.errors} errors`);
    return false;
  }

  return true;
}
```

### Goal Tracking Integration

```typescript
// Track agent goals with ContexGin
async function trackGoal(title: string, contextTokens: number) {
  const res = await fetch('http://127.0.0.1:4195/api/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      contextCondition: 'compiled',
      bootPayloadTokens: contextTokens,
    }),
  });

  return await res.json();
}

// Record usage at end of session
async function recordUsage(
  goalId: string,
  sessionData: {
    inputTokens: number;
    outputTokens: number;
    turns: number;
    toolCalls: number;
    durationMs: number;
  },
) {
  await fetch(`http://127.0.0.1:4195/api/goals/${goalId}/contributions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'my-harness',
      sourceId: crypto.randomUUID(),
      ...sessionData,
    }),
  });
}
```

## CI/CD Integration

### Structural Validation in CI

Add ContexGin validation to your CI pipeline to catch constitution drift:

```yaml
# .github/workflows/validate.yml
name: Validate workspace structure
on:
  pull_request:
    paths:
      - '**/CONSTITUTION.md'
      - '**/CLAUDE.md'
      - '.centaurignore'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install github:dimakis/contexgin
      - run: npx contexgin validate .
```

### CLI Validation in Scripts

```bash
#!/bin/bash
# Validate workspace before deploying agent definitions
npx contexgin validate ~/my-workspace

if [ $? -ne 0 ]; then
  echo "Structural validation failed -- fix issues before deploying"
  exit 1
fi

echo "Workspace validated -- deploying agent definitions"
```

## Graph Exploration

### Inspect Workspace Topology

```bash
# Full graph summary
npx contexgin graph ~/redhat/mgmt

# Via API
curl -s http://127.0.0.1:4195/graph | jq '.hubs[].name'

# Single hub detail
curl -s http://127.0.0.1:4195/graph/mgmt | jq '.spokes[].name'
```

### Query Spoke Boundaries

```bash
# Check which spokes have hard confidentiality boundaries
curl -s http://127.0.0.1:4195/graph | \
  jq '.hubs[].spokes[] | select(.confidentiality == "hard") | .name'
```

## Unix Socket

For local-only communication (no TCP overhead), use Unix sockets:

```bash
# Start daemon with socket
npx contexgin serve ~/my-workspace --socket /tmp/contexgin.sock

# Query via socket
curl --unix-socket /tmp/contexgin.sock http://localhost/health
```

This is useful for high-frequency polling or when you want to avoid TCP port allocation.
