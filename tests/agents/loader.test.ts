import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentLoader } from '../../src/agents/loader.js';

// ── Fixtures ───────────────────────────────────────────────────

const VALID_DEFINITION = `
kind: AgentDefinition
version: "0.1"

identity:
  name: test-agent
  description: A test agent
  mode: narrow

provider:
  default: gpt-4o

context:
  budget: 8000
  sources:
    hubs:
      - path: /tmp/workspace
        spokes: []
  priority: []
  exclude: []
  profile: null

output:
  conventions:
    commit_style: conventional
    response_format: structured
  guides: []

governance:
  boundaries: []
  approval:
    required_for: []
    auto_allow:
      - Read

memory:
  scope: none
  vault: null
`;

const DYNAMIC_DEFINITION = `
kind: AgentDefinition
version: "0.1"

identity:
  name: dynamic-agent
  description: A dynamic agent
  mode: dynamic

provider:
  default: claude-opus-4

context:
  budget: 24000
  sources:
    hubs:
      - path: /tmp/workspace
  priority:
    - CONSTITUTION.md
  exclude: []
  profile: management

output:
  conventions:
    commit_style: null
    response_format: null
  guides: []

governance:
  boundaries: []
  approval:
    required_for: []
    auto_allow: []

memory:
  scope: read-write
  vault: memory/
`;

const INVALID_KIND = `
kind: SomethingElse
version: "0.1"
identity:
  name: bad-agent
  mode: narrow
`;

const INVALID_BUDGET = `
kind: AgentDefinition
version: "0.1"
identity:
  name: zero-budget
  description: Invalid
  mode: narrow
provider:
  default: gpt-4o
context:
  budget: 0
  sources:
    hubs: []
memory:
  scope: none
`;

const MISSING_DESCRIPTION = `
kind: AgentDefinition
version: "0.1"
identity:
  name: no-description
  mode: narrow
provider:
  default: gpt-4o
context:
  budget: 8000
  sources:
    hubs:
      - path: /tmp/workspace
memory:
  scope: none
`;

const MISSING_HUBS = `
kind: AgentDefinition
version: "0.1"
identity:
  name: no-hubs
  description: Missing hubs
  mode: narrow
provider:
  default: gpt-4o
context:
  budget: 8000
  sources: {}
memory:
  scope: none
`;

const SCALAR_YAML = `42`;
const EMPTY_YAML = ``;

// ── Tests ──────────────────────────────────────────────────────

describe('AgentLoader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-agent-loader-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads valid agent definitions from a directory', async () => {
    await fs.writeFile(path.join(tmpDir, 'test-agent.yaml'), VALID_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual(['test-agent']);

    const def = loader.get('test-agent');
    expect(def).toBeDefined();
    expect(def!.identity.name).toBe('test-agent');
    expect(def!.identity.mode).toBe('narrow');
    expect(def!.provider.default).toBe('gpt-4o');
    expect(def!.context.budget).toBe(8000);
    expect(def!.memory.scope).toBe('none');
  });

  it('loads multiple definitions', async () => {
    await fs.writeFile(path.join(tmpDir, 'narrow.yaml'), VALID_DEFINITION);
    await fs.writeFile(path.join(tmpDir, 'dynamic.yaml'), DYNAMIC_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toHaveLength(2);
    expect(loader.list()).toContain('test-agent');
    expect(loader.list()).toContain('dynamic-agent');
  });

  it('skips files with invalid kind', async () => {
    await fs.writeFile(path.join(tmpDir, 'bad.yaml'), INVALID_KIND);
    await fs.writeFile(path.join(tmpDir, 'good.yaml'), VALID_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual(['test-agent']);
  });

  it('skips files with invalid budget', async () => {
    await fs.writeFile(path.join(tmpDir, 'zero.yaml'), INVALID_BUDGET);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual([]);
  });

  it('skips non-YAML files', async () => {
    await fs.writeFile(path.join(tmpDir, 'readme.md'), '# Not YAML');
    await fs.writeFile(path.join(tmpDir, 'agent.yaml'), VALID_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual(['test-agent']);
  });

  it('handles non-existent directories gracefully', async () => {
    const loader = new AgentLoader(['/tmp/nonexistent-dir-12345']);
    await loader.load();

    expect(loader.list()).toEqual([]);
  });

  it('returns undefined for unknown agent names', async () => {
    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.get('nonexistent')).toBeUndefined();
  });

  it('loads from multiple search paths', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-agent-loader-2-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'narrow.yaml'), VALID_DEFINITION);
      await fs.writeFile(path.join(dir2, 'dynamic.yaml'), DYNAMIC_DEFINITION);

      const loader = new AgentLoader([tmpDir, dir2]);
      await loader.load();

      expect(loader.list()).toHaveLength(2);
    } finally {
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  it('clears definitions on reload', async () => {
    await fs.writeFile(path.join(tmpDir, 'agent.yaml'), VALID_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();
    expect(loader.list()).toHaveLength(1);

    // Remove the file and reload
    await fs.unlink(path.join(tmpDir, 'agent.yaml'));
    await loader.load();
    expect(loader.list()).toHaveLength(0);
  });

  it('supports .yml extension', async () => {
    await fs.writeFile(path.join(tmpDir, 'agent.yml'), VALID_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual(['test-agent']);
  });

  it('all() returns full definitions', async () => {
    await fs.writeFile(path.join(tmpDir, 'agent.yaml'), VALID_DEFINITION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    const all = loader.all();
    expect(all).toHaveLength(1);
    expect(all[0].kind).toBe('AgentDefinition');
    expect(all[0].identity.name).toBe('test-agent');
  });

  it('skips files missing identity.description', async () => {
    await fs.writeFile(path.join(tmpDir, 'no-desc.yaml'), MISSING_DESCRIPTION);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual([]);
  });

  it('skips files missing context.sources.hubs', async () => {
    await fs.writeFile(path.join(tmpDir, 'no-hubs.yaml'), MISSING_HUBS);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual([]);
  });

  it('skips empty YAML files', async () => {
    await fs.writeFile(path.join(tmpDir, 'empty.yaml'), EMPTY_YAML);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual([]);
  });

  it('skips YAML files containing scalar values', async () => {
    await fs.writeFile(path.join(tmpDir, 'scalar.yaml'), SCALAR_YAML);

    const loader = new AgentLoader([tmpDir]);
    await loader.load();

    expect(loader.list()).toEqual([]);
  });

  it('expands tilde in search paths', async () => {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const relativeDir = tmpDir.replace(homeDir, '~');

    await fs.writeFile(path.join(tmpDir, 'agent.yaml'), VALID_DEFINITION);

    const loader = new AgentLoader([relativeDir]);
    await loader.load();

    expect(loader.list()).toEqual(['test-agent']);
  });
});
