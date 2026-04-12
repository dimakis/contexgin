# Contexgin Integration Examples

Integration patterns for connecting Contexgin's daemon API to various agent harnesses and custom tooling.

## Claude Code (CLAUDE.md hook)

Add to your project's `CLAUDE.md`:

```markdown
## Workspace Health

Contexgin daemon runs at http://127.0.0.1:4195. Before starting work:

- `curl http://127.0.0.1:4195/health` — check for structural errors
- `curl -X POST http://127.0.0.1:4195/compile -H 'Content-Type: application/json' -d '{"spoke":"<spoke>","task":"<your task>"}'` — get compiled context for the spoke you're working in
```

## Cursor (.cursor/rules/)

Create `.cursor/rules/contexgin.mdc`:

```markdown
---
description: Contexgin workspace context
alwaysApply: false
globs: ['**/CONSTITUTION.md', '**/CLAUDE.md']
---

When editing constitution or context files, validate changes:
\`\`\`bash
curl -X POST http://127.0.0.1:4195/validate -H 'Content-Type: application/json' -d '{}'
\`\`\`

Check for structural drift before committing governance changes.
```

## Mitzo / Custom Agents

```typescript
// Fetch compiled context for a task
const res = await fetch('http://127.0.0.1:4195/compile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    spoke: 'command_center',
    task: 'add new briefing type',
    budget: 6000,
  }),
});
const { context, tokens, sources } = await res.json();
// Inject `context` into your agent's system prompt
```

```typescript
// Monitor for drift in an agent loop
const health = await fetch('http://127.0.0.1:4195/health').then((r) => r.json());
if (health.violations.errors > 0) {
  console.warn(`Structural drift: ${health.violations.errors} errors`);
}
```
