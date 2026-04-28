import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { compileAgent } from '../../src/recipe/compiler.js';
import type { AgentDefinition } from '../../src/recipe/types.js';

describe('compileAgent', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-compiler-'));

    // Create a minimal workspace structure
    await fs.writeFile(
      path.join(tmpDir, 'CONSTITUTION.md'),
      '# Test Constitution\n\nThis is a test constitution.',
    );
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# Test CLAUDE.md\n\nInstructions here.');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const createMinimalAgent = (): AgentDefinition => ({
    kind: 'AgentDefinition',
    version: '0.1',
    identity: {
      name: 'test-agent',
      description: 'A test agent',
      mode: 'narrow',
    },
    provider: {
      provider: 'anthropic',
      model: 'claude-opus-4',
    },
    context: {},
    governance: {},
  });

  it('compiles agent with no context configuration', async () => {
    const def = createMinimalAgent();
    const result = await compileAgent(def, tmpDir);

    expect(result.identity).toEqual(def.identity);
    expect(result.bootContext.content).toBe('');
    expect(result.bootContext.tokens).toBe(0);
    expect(result.contextBlocks.size).toBe(0);
    expect(result.operational).toBeUndefined();
    expect(result.memory).toBeUndefined();
  });

  it('compiles boot context with default sources', async () => {
    const def = createMinimalAgent();
    def.context.boot = { tokenBudget: 8000 };

    const result = await compileAgent(def, tmpDir);

    // Boot context should be compiled even if empty
    expect(result.bootContext.content).toBeDefined();
    expect(result.bootContext.tokens).toBeGreaterThanOrEqual(0);
    expect(result.bootContext.tokens).toBeLessThan(8000);
    expect(result.bootContext.sources).toBeDefined();
  });

  it('excludes CONSTITUTION.md when disabled', async () => {
    const def = createMinimalAgent();
    def.context.boot = {
      tokenBudget: 8000,
      constitution: false,
    };

    const result = await compileAgent(def, tmpDir);

    expect(result.bootContext.sources).not.toContain('CONSTITUTION.md');
  });

  it('excludes CLAUDE.md when disabled', async () => {
    const def = createMinimalAgent();
    def.context.boot = {
      tokenBudget: 8000,
      claudeMd: false,
    };

    const result = await compileAgent(def, tmpDir);

    expect(result.bootContext.sources).not.toContain('CLAUDE.md');
  });

  it('compiles context blocks from files', async () => {
    const blockFile = path.join(tmpDir, 'block.md');
    await fs.writeFile(blockFile, '# Context Block\n\nSome context here.');

    const def = createMinimalAgent();
    def.context.blocks = [
      {
        id: 'test-block',
        source: 'block.md',
      },
    ];

    const result = await compileAgent(def, tmpDir);

    expect(result.contextBlocks.has('test-block')).toBe(true);
    const block = result.contextBlocks.get('test-block');
    expect(block?.content).toContain('Context Block');
    expect(block?.tokens).toBeGreaterThan(0);
    expect(block?.source).toBe('block.md');
  });

  it('handles missing context block files gracefully', async () => {
    const def = createMinimalAgent();
    def.context.blocks = [
      {
        id: 'missing',
        source: 'nonexistent.md',
      },
    ];

    const result = await compileAgent(def, tmpDir);

    expect(result.contextBlocks.has('missing')).toBe(false);
  });

  it('expands tilde in context block paths', async () => {
    const homeFile = path.join(os.homedir(), 'test-contexgin-block.md');
    await fs.writeFile(homeFile, '# Home Block\n\nFrom home directory.');

    try {
      const def = createMinimalAgent();
      def.context.blocks = [
        {
          id: 'home-block',
          source: '~/test-contexgin-block.md',
        },
      ];

      const result = await compileAgent(def, tmpDir);

      expect(result.contextBlocks.has('home-block')).toBe(true);
      const block = result.contextBlocks.get('home-block');
      expect(block?.content).toContain('Home Block');
    } finally {
      await fs.unlink(homeFile);
    }
  });

  it('compiles operational context from file list', async () => {
    const opFile = path.join(tmpDir, 'operational.md');
    await fs.writeFile(opFile, '# Operational\n\nAlways-on context.');

    const def = createMinimalAgent();
    def.context.operational = {
      files: ['operational.md'],
      delivery: 'additionalContext',
    };

    const result = await compileAgent(def, tmpDir);

    expect(result.operational).toBeDefined();
    expect(result.operational?.files).toHaveLength(1);
    expect(result.operational?.files[0].path).toBe('operational.md');
    expect(result.operational?.files[0].content).toContain('Operational');
    expect(result.operational?.delivery).toBe('additionalContext');
  });

  it('compiles memory context from directory', async () => {
    const memoryDir = path.join(tmpDir, 'memory');
    await fs.mkdir(path.join(memoryDir, 'Feedback'), { recursive: true });
    await fs.mkdir(path.join(memoryDir, 'User'), { recursive: true });

    await fs.writeFile(
      path.join(memoryDir, 'Feedback', 'feedback_example.md'),
      '# Feedback\n\nUser likes X.',
    );
    await fs.writeFile(path.join(memoryDir, 'User', 'user_pref.md'), '# User Pref\n\nPrefers Y.');

    const def = createMinimalAgent();
    def.context.memory = {
      enabled: true,
      path: path.join(tmpDir, 'memory'),
      types: ['feedback', 'user'],
    };

    const result = await compileAgent(def, tmpDir);

    expect(result.memory).toBeDefined();
    expect(result.memory?.feedback.length).toBe(1);
    expect(result.memory?.feedback[0]).toContain('User likes X');
    expect(result.memory?.user.length).toBe(1);
    expect(result.memory?.user[0]).toContain('Prefers Y');
    expect(result.memory?.project.length).toBe(0);
    expect(result.memory?.reference.length).toBe(0);
  });

  it('skips memory compilation when disabled', async () => {
    const def = createMinimalAgent();
    def.context.memory = {
      enabled: false,
      path: '/nonexistent',
    };

    const result = await compileAgent(def, tmpDir);

    expect(result.memory).toBeUndefined();
  });

  it('skips memory compilation when path is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const def = createMinimalAgent();
    def.context.memory = {
      enabled: true,
      // path is missing
    };

    const result = await compileAgent(def, tmpDir);

    expect(result.memory).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Memory enabled but no path specified'),
    );

    consoleSpy.mockRestore();
  });
});
