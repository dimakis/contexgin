import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadAgentDefinition, loadAgentDefinitions, validateAgentDefinition } from '../../src/recipe/loader.js';
import type { AgentDefinition } from '../../src/recipe/types.js';

async function createTestAgentYaml(content: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-recipe-'));
  const filePath = path.join(tmpDir, 'agent.yaml');
  await fs.writeFile(filePath, content);
  return filePath;
}

describe('loadAgentDefinition', () => {
  it('loads a valid agent definition', async () => {
    const yaml = `
identity:
  name: test-agent
  description: A test agent
  role: Testing

provider:
  provider: anthropic
  model: claude-sonnet-4.5

context:
  boot:
    constitution: true
    claudeMd: true
    tokenBudget: 8000

skills:
  - id: code-review
    description: Review code for issues
    enabled: true
`;

    const filePath = await createTestAgentYaml(yaml);
    try {
      const def = await loadAgentDefinition(filePath);

      expect(def.identity.name).toBe('test-agent');
      expect(def.identity.description).toBe('A test agent');
      expect(def.identity.role).toBe('Testing');
      expect(def.provider.provider).toBe('anthropic');
      expect(def.provider.model).toBe('claude-sonnet-4.5');
      expect(def.context.boot?.constitution).toBe(true);
      expect(def.context.boot?.tokenBudget).toBe(8000);
      expect(def.skills).toHaveLength(1);
      expect(def.skills![0].id).toBe('code-review');
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true });
    }
  });

  it('throws on missing identity', async () => {
    const yaml = `
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`;

    const filePath = await createTestAgentYaml(yaml);
    try {
      await expect(loadAgentDefinition(filePath)).rejects.toThrow('missing required field: identity');
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true });
    }
  });

  it('throws on missing identity.name', async () => {
    const yaml = `
identity:
  description: Test agent

provider:
  provider: anthropic
  model: claude-sonnet-4.5
`;

    const filePath = await createTestAgentYaml(yaml);
    try {
      await expect(loadAgentDefinition(filePath)).rejects.toThrow('identity missing required field: name');
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true });
    }
  });

  it('throws on missing provider', async () => {
    const yaml = `
identity:
  name: test-agent
  description: Test agent
`;

    const filePath = await createTestAgentYaml(yaml);
    try {
      await expect(loadAgentDefinition(filePath)).rejects.toThrow('missing required field: provider');
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true });
    }
  });

  it('loads minimal valid definition', async () => {
    const yaml = `
identity:
  name: minimal
  description: Minimal agent

provider:
  provider: openai
  model: gpt-4
`;

    const filePath = await createTestAgentYaml(yaml);
    try {
      const def = await loadAgentDefinition(filePath);
      expect(def.identity.name).toBe('minimal');
      expect(def.provider.provider).toBe('openai');
      expect(def.provider.model).toBe('gpt-4');
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true });
    }
  });

  it('loads definition with all sections', async () => {
    const yaml = `
identity:
  name: full-agent
  description: Full-featured agent
  role: Multi-purpose

provider:
  provider: anthropic
  model: claude-opus-4.6
  temperature: 0.7
  maxTokens: 4096

context:
  boot:
    constitution: true
    claudeMd: ["Git Discipline", "Entry Points"]
    profile: true
    cursorRules: false
    tokenBudget: 8000

  blocks:
    - id: jira-context
      source: ~/redhat/team_home/jira_process/context/workflow.md
      taskHint: "Jira workflow context"

  operational:
    files:
      - .cursor/rules/git-discipline.mdc
      - .cursor/rules/commit-format.mdc
    delivery: alwaysApply

  memory:
    enabled: true
    path: ~/.claude/projects/-Users-dsaridak-redhat-mgmt/memory
    types: [feedback, user, project]

governance:
  forbidden:
    - Never commit directly to main
    - Never skip pre-commit hooks
  required:
    - Always write tests for new features
  approvalRequired:
    - Destructive git operations
    - Force push to remote

skills:
  - id: code-review
    description: Review code for issues
    enabled: true
  - id: jira-query
    description: Query Jira for issues
    enabled: false

metadata:
  version: "1.0.0"
  updated: "2026-04-25"
  author: Dimitri
  tags: [conversational, multi-purpose]
`;

    const filePath = await createTestAgentYaml(yaml);
    try {
      const def = await loadAgentDefinition(filePath);

      expect(def.identity.name).toBe('full-agent');
      expect(def.provider.temperature).toBe(0.7);
      expect(def.context.boot?.claudeMd).toEqual(['Git Discipline', 'Entry Points']);
      expect(def.context.blocks).toHaveLength(1);
      expect(def.context.blocks![0].id).toBe('jira-context');
      expect(def.context.operational?.delivery).toBe('alwaysApply');
      expect(def.context.memory?.types).toEqual(['feedback', 'user', 'project']);
      expect(def.governance?.forbidden).toHaveLength(2);
      expect(def.skills).toHaveLength(2);
      expect(def.metadata?.version).toBe('1.0.0');
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true });
    }
  });
});

describe('loadAgentDefinitions', () => {
  it('loads multiple agent definitions from directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-recipe-'));

    const agent1 = `
identity:
  name: agent-one
  description: First agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`;

    const agent2 = `
identity:
  name: agent-two
  description: Second agent
provider:
  provider: openai
  model: gpt-4
`;

    await fs.writeFile(path.join(tmpDir, 'agent1.yaml'), agent1);
    await fs.writeFile(path.join(tmpDir, 'agent2.yml'), agent2);
    await fs.writeFile(path.join(tmpDir, 'readme.txt'), 'not an agent');

    try {
      const defs = await loadAgentDefinitions(tmpDir);

      expect(defs.size).toBe(2);
      expect(defs.has('agent-one')).toBe(true);
      expect(defs.has('agent-two')).toBe(true);
      expect(defs.get('agent-one')?.provider.provider).toBe('anthropic');
      expect(defs.get('agent-two')?.provider.provider).toBe('openai');
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it('skips invalid agent definitions', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-recipe-'));

    const valid = `
identity:
  name: valid-agent
  description: Valid agent
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`;

    const invalid = `
identity:
  name: invalid-agent
  # missing description
provider:
  provider: anthropic
  model: claude-sonnet-4.5
`;

    await fs.writeFile(path.join(tmpDir, 'valid.yaml'), valid);
    await fs.writeFile(path.join(tmpDir, 'invalid.yaml'), invalid);

    try {
      const defs = await loadAgentDefinitions(tmpDir);

      expect(defs.size).toBe(1);
      expect(defs.has('valid-agent')).toBe(true);
      expect(defs.has('invalid-agent')).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it('returns empty map for non-existent directory', async () => {
    const defs = await loadAgentDefinitions('/does/not/exist');
    expect(defs.size).toBe(0);
  });
});

describe('validateAgentDefinition', () => {
  it('validates a correct definition', () => {
    const def: AgentDefinition = {
      identity: {
        name: 'test',
        description: 'Test agent',
      },
      provider: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
      },
      context: {},
    };

    const errors = validateAgentDefinition(def);
    expect(errors).toHaveLength(0);
  });

  it('catches missing identity fields', () => {
    const def: AgentDefinition = {
      identity: {
        name: '',
        description: '',
      },
      provider: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
      },
      context: {},
    };

    const errors = validateAgentDefinition(def);
    expect(errors).toContain('identity.name is required');
    expect(errors).toContain('identity.description is required');
  });

  it('catches missing provider fields', () => {
    const def: AgentDefinition = {
      identity: {
        name: 'test',
        description: 'Test',
      },
      provider: {
        provider: '',
        model: '',
      },
      context: {},
    };

    const errors = validateAgentDefinition(def);
    expect(errors).toContain('provider.provider is required');
    expect(errors).toContain('provider.model is required');
  });

  it('validates boot context token budget', () => {
    const def: AgentDefinition = {
      identity: {
        name: 'test',
        description: 'Test',
      },
      provider: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
      },
      context: {
        boot: {
          tokenBudget: -100,
        },
      },
    };

    const errors = validateAgentDefinition(def);
    expect(errors).toContain('context.boot.tokenBudget must be positive');
  });

  it('validates context blocks', () => {
    const def: AgentDefinition = {
      identity: {
        name: 'test',
        description: 'Test',
      },
      provider: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
      },
      context: {
        blocks: [
          { id: '', source: '' },
          { id: 'valid', source: 'path' },
        ],
      },
    };

    const errors = validateAgentDefinition(def);
    expect(errors).toContain('context.blocks[].id is required');
    expect(errors).toContain('context.blocks[].source is required');
  });

  it('validates skills', () => {
    const def: AgentDefinition = {
      identity: {
        name: 'test',
        description: 'Test',
      },
      provider: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
      },
      context: {},
      skills: [
        { id: '', description: '', enabled: true },
        { id: 'valid', description: 'Valid skill', enabled: false },
      ],
    };

    const errors = validateAgentDefinition(def);
    expect(errors).toContain('skills[].id is required');
    expect(errors).toContain('skills[].description is required');
  });
});
