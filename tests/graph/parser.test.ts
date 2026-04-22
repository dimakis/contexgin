import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { parseConstitution, parseConstitutionContent } from '../../src/graph/parser.js';

const FIXTURES = path.resolve(import.meta.dirname, '..', 'fixtures', 'constitutions');

// ── Synthetic Tests ──────────────────────────────────────────────

describe('parseConstitutionContent', () => {
  describe('Purpose extraction', () => {
    it('extracts first paragraph after ## Purpose', () => {
      const content = `# Test
## Purpose

This is the purpose of the workspace.

More text here.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.purpose).toBe('This is the purpose of the workspace.');
    });

    it('handles missing Purpose section', () => {
      const content = `# Test\n## Architecture\nSome stuff.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.purpose).toBe('');
    });

    it('stops at next heading', () => {
      const content = `## Purpose\nThe purpose.\n## Next Section\nNot this.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.purpose).toBe('The purpose.');
    });
  });

  describe('Directory tree extraction', () => {
    it('extracts from directory semantics table', () => {
      const content = `## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
| \`tests/\` | Test files |
| \`README.md\` | Documentation |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(3);
      expect(result.tree[0]).toEqual({
        path: 'src/',
        name: 'src',
        type: 'directory',
        description: 'Source code',
      });
      expect(result.tree[1]).toEqual({
        path: 'tests/',
        name: 'tests',
        type: 'directory',
        description: 'Test files',
      });
      expect(result.tree[2]).toEqual({
        path: 'README.md',
        name: 'README.md',
        type: 'file',
        description: 'Documentation',
      });
    });

    it('handles three-column tables (Path | Belongs | Doesnt)', () => {
      const content = `## Directory Semantics

| Path | What belongs here | What doesn't |
|------|------------------|--------------|
| \`lib/\` | Shared utilities | Application code |
| \`config/\` | Pipeline settings | Credentials |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(2);
      expect(result.tree[0].path).toBe('lib/');
      expect(result.tree[0].description).toBe('Shared utilities');
    });

    it('filters out (root) self-reference entries', () => {
      const content = `## Directory Semantics

| Path | What belongs here | What doesn't |
|------|------------------|--------------|
| \`mgmt/\` (root) | This constitution | Data files |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(0);
    });

    it('keeps non-root entries when (root) entries are present', () => {
      const content = `## Directory Semantics

| Path | What belongs here | What doesn't |
|------|------------------|--------------|
| \`professional/\` (root) | This constitution | N/A |
| \`docs/\` | Documentation | Code |
| \`src/\` | Source code | Tests |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(2);
      expect(result.tree[0].path).toBe('docs/');
      expect(result.tree[1].path).toBe('src/');
    });

    it('handles section titled "Directory Structure"', () => {
      const content = `## Directory Structure

| Directory | Contains |
|-----------|----------|
| \`src/\` | All source code |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(1);
      expect(result.tree[0].path).toBe('src/');
    });

    it('returns empty array for missing section', () => {
      const content = `## Purpose\nSomething.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toEqual([]);
    });

    it('handles tables without leading pipes', () => {
      const content = `## Directory Semantics

Path | What belongs here
-----|------------------
\`src/\` | Source code
\`tests/\` | Test files
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(2);
      expect(result.tree[0].path).toBe('src/');
      expect(result.tree[1].path).toBe('tests/');
    });

    it('handles paths without backticks and skips bare "Root" entries', () => {
      const content = `## Directory Semantics

| Path | What belongs here |
|------|------------------|
| Root | This constitution |
| rootfs/ | Root filesystem |
| root-config.yml | Root config |
| src/ | Source code |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(3);
      expect(result.tree[0].path).toBe('rootfs/');
      expect(result.tree[1].path).toBe('root-config.yml');
      expect(result.tree[2].path).toBe('src/');
    });

    it('splits compound paths like ".env / .env.example" into separate entries', () => {
      const content = `## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`.env / .env.example\` | Secrets and environment config |
| \`src/\` | Source code |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toHaveLength(3);
      expect(result.tree[0].path).toBe('.env');
      expect(result.tree[0].type).toBe('file');
      expect(result.tree[1].path).toBe('.env.example');
      expect(result.tree[1].type).toBe('file');
      expect(result.tree[2].path).toBe('src/');
    });
  });

  describe('Entry points extraction', () => {
    it('extracts from Command | Description table', () => {
      const content = `## Entry Points

| Command | Description |
|---------|-------------|
| \`./mgmt\` | Interactive CLI |
| \`./mgmt refresh\` | Full pipeline |
`;
      const result = parseConstitutionContent(content, '/test.md', 'hub');
      expect(result.entryPoints).toHaveLength(2);
      expect(result.entryPoints[0]).toEqual({
        name: './mgmt',
        command: './mgmt',
        description: 'Interactive CLI',
        sourceId: 'hub',
      });
      expect(result.entryPoints[1]).toEqual({
        name: './mgmt',
        command: './mgmt refresh',
        description: 'Full pipeline',
        sourceId: 'hub',
      });
    });

    it('extracts from Export | Description table', () => {
      const content = `## Entry Points

| Export | Description |
|--------|-------------|
| \`compile()\` | Main compiler function |
| \`validateAll()\` | Run all validators |
`;
      const result = parseConstitutionContent(content, '/test.md', 'lib');
      expect(result.entryPoints).toHaveLength(2);
      expect(result.entryPoints[0].command).toBe('compile()');
      expect(result.entryPoints[0].name).toBe('compile');
    });

    it('returns empty for missing section', () => {
      const content = `## Purpose\nA library.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.entryPoints).toEqual([]);
    });
  });

  describe('Dependencies extraction', () => {
    it('ignores bullet-list dependencies (no backtick mining)', () => {
      const content = `## Dependencies

- \`auth/\` — needs token validation
- \`db/\` — stores data
`;
      const result = parseConstitutionContent(content, '/test.md', 'api');
      // Bullet lists are not extracted — only table format is supported
      expect(result.dependencies).toHaveLength(0);
    });

    it('ignores prose-style bullets (no backtick mining)', () => {
      const content = `## Dependencies

- Reads from \`jira_process/\` for pipeline data
`;
      const result = parseConstitutionContent(content, '/test.md', 'api');
      expect(result.dependencies).toHaveLength(0);
    });

    it('ignores bullet list with no backticks (no backtick mining)', () => {
      const content = `## Dependencies

- auth service for tokens
`;
      const result = parseConstitutionContent(content, '/test.md', 'api');
      expect(result.dependencies).toHaveLength(0);
    });

    it('extracts from table format', () => {
      const content = `## Dependencies

| Dependency | Purpose |
|------------|---------|
| \`auth\` | Token validation |
| \`db\` | Data storage |
`;
      const result = parseConstitutionContent(content, '/test.md', 'api');
      expect(result.dependencies).toHaveLength(2);
      expect(result.dependencies[0].to).toBe('auth');
      expect(result.dependencies[0].description).toBe('Token validation');
    });

    it('returns empty for missing section', () => {
      const content = `## Purpose\nStandalone.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.dependencies).toEqual([]);
    });
  });

  describe('Boundaries extraction', () => {
    it('extracts from confidentiality section with bullet items', () => {
      const content = `## Confidentiality

- Never flows into \`jira_process/\`
- Never appears in reports
`;
      const result = parseConstitutionContent(content, '/test.md', 'career');
      expect(result.boundaries).toHaveLength(1);
      expect(result.boundaries[0].level).toBe('hard');
      expect(result.boundaries[0].excludedFrom).toContain('jira_process/');
    });

    it('detects hard confidentiality from "never" keyword', () => {
      const content = `### Confidentiality Boundaries
- This content never leaves this directory
`;
      const result = parseConstitutionContent(content, '/test.md', 'secrets');
      expect(result.boundaries[0].level).toBe('hard');
    });

    it('detects soft confidentiality from "caution" keyword', () => {
      const content = `## Boundaries
- Use caution when sharing externally
`;
      const result = parseConstitutionContent(content, '/test.md', 'internal');
      expect(result.boundaries[0].level).toBe('soft');
    });

    it('returns empty for missing section', () => {
      const content = `## Purpose\nPublic library.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.boundaries).toEqual([]);
    });
  });

  describe('Principles extraction', () => {
    it('extracts sub-heading names as principles', () => {
      const content = `## Principles

### 1. Constitution Governs, Code Follows
Text.

### 2. Confidentiality Boundaries Are Hard Lines
More text.

### 3. Memory Is The System
Yet more text.
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.principles).toEqual([
        'Constitution Governs, Code Follows',
        'Confidentiality Boundaries Are Hard Lines',
        'Memory Is The System',
      ]);
    });

    it('returns empty for missing section', () => {
      const content = `## Purpose\nNo principles here.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.principles).toEqual([]);
    });
  });

  describe('Spoke declarations extraction', () => {
    it('extracts from Sub-Repo | Audience | Governance | Purpose table', () => {
      const content = `## Spoke Charters

| Sub-Repo | Audience | Governance | Purpose |
|----------|----------|------------|---------|
| \`auth/\` | Engineers | Own constitution | Authentication service |
| \`api/\` | Engineers | Shared | REST API layer |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.spokeDeclarations).toHaveLength(2);
      expect(result.spokeDeclarations[0]).toEqual({
        name: 'auth',
        purpose: 'Authentication service',
        governance: 'Own constitution',
        audience: 'Engineers',
        confidentiality: 'none',
      });
    });

    it('extracts from 5-column spoke table', () => {
      const content = `## Spoke Charters

| Spoke | Function | Input | Process | Output |
|-------|----------|-------|---------|--------|
| \`blog/\` | Content factory | Ideas | Ideate → Publish | Blog posts |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.spokeDeclarations).toHaveLength(1);
      expect(result.spokeDeclarations[0].name).toBe('blog');
      // With 5 columns, cells[1]=Audience, cells[2]=Governance, cells[3]=Purpose
      expect(result.spokeDeclarations[0].audience).toBe('Content factory');
    });

    it('does not treat Architecture tables as spoke declarations', () => {
      const content = `## Architecture

| Module | Responsibility |
|--------|---------------|
| \`compiler/\` | Parse context sources |
| \`integrity/\` | Validate claims |
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      // Architecture modules are internal structure, not workspace-root spokes
      expect(result.spokeDeclarations).toHaveLength(0);
    });

    it('returns empty for no spoke-like sections', () => {
      const content = `## Purpose\nA leaf spoke.`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.spokeDeclarations).toEqual([]);
    });
  });

  describe('Empty / malformed input', () => {
    it('handles empty content', () => {
      const result = parseConstitutionContent('', '/test.md', 'test');
      expect(result.purpose).toBe('');
      expect(result.tree).toEqual([]);
      expect(result.entryPoints).toEqual([]);
      expect(result.dependencies).toEqual([]);
      expect(result.boundaries).toEqual([]);
      expect(result.principles).toEqual([]);
      expect(result.spokeDeclarations).toEqual([]);
    });

    it('handles content with no sections', () => {
      const result = parseConstitutionContent(
        'Just a paragraph with no headings.',
        '/test.md',
        'test',
      );
      expect(result.purpose).toBe('');
    });

    it('handles table with no data rows', () => {
      const content = `## Directory Semantics

| Path | Description |
|------|-------------|
`;
      const result = parseConstitutionContent(content, '/test.md', 'test');
      expect(result.tree).toEqual([]);
    });
  });
});

// ── Fixture Constitution Tests ───────────────────────────────────
// These test parseConstitution (file-reading) against committed synthetic
// constitutions that cover real-world format variations.

describe('parseConstitution (fixture files)', () => {
  describe('hub-multi-spoke', () => {
    it('extracts purpose', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'hub-multi-spoke.md'), 'acme');
      expect(result.purpose).toBe('A multi-spoke workspace for testing parser format variations.');
    });

    it('extracts spoke declarations from 4-column table', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'hub-multi-spoke.md'), 'acme');
      expect(result.spokeDeclarations.length).toBe(6);
      const names = result.spokeDeclarations.map((s) => s.name);
      expect(names).toContain('api');
      expect(names).toContain('auth');
      expect(names).toContain('internal');
    });

    it('extracts entry points including args and functions', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'hub-multi-spoke.md'), 'acme');
      expect(result.entryPoints.length).toBe(7);
      const commands = result.entryPoints.map((e) => e.command);
      expect(commands).toContain('./run');
      expect(commands).toContain('./run serve');
      expect(commands).toContain('compile()');
    });

    it('extracts principles', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'hub-multi-spoke.md'), 'acme');
      expect(result.principles).toEqual([
        'Tests Come First',
        'Keep It Simple',
        'Boundaries Matter',
      ]);
    });

    it('extracts directory semantics and filters (root)', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'hub-multi-spoke.md'), 'acme');
      // The (root) entry should be filtered out
      const paths = result.tree.map((n) => n.path);
      expect(paths).not.toContain('acme/');
      expect(paths).toContain('scripts/');
      expect(paths).toContain('config/');
      expect(paths).toContain('.github/');
    });

    it('extracts table-format dependencies', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'hub-multi-spoke.md'), 'acme');
      expect(result.dependencies.length).toBe(2);
      expect(result.dependencies[0].to).toBe('postgres');
    });
  });

  describe('spoke-with-boundaries', () => {
    it('extracts hard confidentiality boundaries', async () => {
      const result = await parseConstitution(
        path.join(FIXTURES, 'spoke-with-boundaries.md'),
        'internal',
      );
      expect(result.boundaries.length).toBeGreaterThan(0);
      expect(result.boundaries[0].level).toBe('hard');
    });

    it('extracts dependencies from table format', async () => {
      const result = await parseConstitution(
        path.join(FIXTURES, 'spoke-with-boundaries.md'),
        'internal',
      );
      expect(result.dependencies.length).toBe(3);
      const targets = result.dependencies.map((d) => d.to);
      expect(targets).toContain('auth/');
      expect(targets).toContain('lib/');
      expect(targets).toContain('api/');
    });
  });

  describe('library-module', () => {
    it('does not extract Architecture modules as spoke declarations', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'library-module.md'), 'contexlib');
      // Architecture tables describe internal modules, not workspace-root spokes
      expect(result.spokeDeclarations).toHaveLength(0);
    });

    it('extracts function export entry points', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'library-module.md'), 'contexlib');
      expect(result.entryPoints.length).toBe(3);
      expect(result.entryPoints[0].command).toBe('compile()');
      expect(result.entryPoints[0].name).toBe('compile');
    });

    it('extracts soft boundaries', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'library-module.md'), 'contexlib');
      expect(result.boundaries.length).toBeGreaterThan(0);
      expect(result.boundaries[0].level).toBe('soft');
    });
  });

  describe('ecosystem-hub', () => {
    it('extracts spokes from 5-column table', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'ecosystem-hub.md'), 'ecosystem');
      expect(result.spokeDeclarations.length).toBe(3);
      expect(result.spokeDeclarations[0].name).toBe('frontend');
    });

    it('extracts directory semantics', async () => {
      const result = await parseConstitution(path.join(FIXTURES, 'ecosystem-hub.md'), 'ecosystem');
      expect(result.tree.length).toBe(3);
      const paths = result.tree.map((n) => n.path);
      expect(paths).toContain('packages/');
      expect(paths).toContain('tools/');
      expect(paths).toContain('docs/');
    });
  });
});
