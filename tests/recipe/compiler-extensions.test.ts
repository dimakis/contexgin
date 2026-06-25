import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { compileAgent } from '../../src/recipe/compiler.js';
import type { AgentDefinition } from '../../src/recipe/types.js';

describe('compiler extensions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-ext-'));
    // Minimal workspace
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# Test\n\nMinimal.');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function baseDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
    return {
      identity: { name: 'test', description: 'test agent' },
      provider: { provider: 'test', model: 'test' },
      context: {},
      ...overrides,
    } as AgentDefinition;
  }

  describe('source globs (BootContextConfig.sources)', () => {
    it('resolves simple wildcard patterns', async () => {
      // Create modules/a/module.json and modules/b/module.json
      await fs.mkdir(path.join(tmpDir, 'modules', 'a'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'modules', 'b'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'modules', 'a', 'module.json'),
        JSON.stringify({ name: 'A' }),
      );
      await fs.writeFile(
        path.join(tmpDir, 'modules', 'b', 'module.json'),
        JSON.stringify({ name: 'B' }),
      );

      const def = baseDef({
        context: {
          boot: {
            tokenBudget: 4000,
            constitution: false,
            claudeMd: false,
            profile: false,
            cursorRules: false,
            spokes: false,
            sources: ['modules/*/module.json'],
          },
        },
      });

      const result = await compileAgent(def, tmpDir);
      // Boot sources should include the glob-resolved files
      const moduleSources = result.bootContext.sources.filter((s) => s.includes('module.json'));
      expect(moduleSources.length).toBeGreaterThanOrEqual(2);
    });

    it('resolves ** recursive patterns', async () => {
      // Create nested module.json files at different depths
      await fs.mkdir(path.join(tmpDir, 'features', 'dashboard'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'features', 'module.json'),
        JSON.stringify({ name: 'Features' }),
      );
      await fs.writeFile(
        path.join(tmpDir, 'features', 'dashboard', 'module.json'),
        JSON.stringify({ name: 'Dashboard' }),
      );

      const def = baseDef({
        context: {
          boot: {
            tokenBudget: 4000,
            constitution: false,
            claudeMd: false,
            profile: false,
            cursorRules: false,
            spokes: false,
            sources: ['features/**/module.json'],
          },
        },
      });

      const result = await compileAgent(def, tmpDir);
      const moduleSources = result.bootContext.sources.filter((s) => s.includes('module.json'));
      expect(moduleSources).toContain('features/module.json');
      expect(moduleSources).toContain('features/dashboard/module.json');
    });

    it('rejects glob patterns with path traversal', async () => {
      const def = baseDef({
        context: {
          boot: {
            tokenBudget: 4000,
            constitution: false,
            claudeMd: false,
            profile: false,
            cursorRules: false,
            spokes: false,
            sources: ['../../etc/*.json'],
          },
        },
      });

      const result = await compileAgent(def, tmpDir);
      // Should produce no sources from the traversal pattern
      const etcSources = result.bootContext.sources.filter((s) => s.includes('etc'));
      expect(etcSources).toHaveLength(0);
    });

    it('matches literal filenames without treating ? as regex', async () => {
      // Create a file with a literal ? in the glob pattern context
      await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'data', 'module.json'),
        JSON.stringify([{ name: 'test', value: 1 }]),
      );

      const def = baseDef({
        context: {
          boot: {
            tokenBudget: 4000,
            constitution: false,
            claudeMd: false,
            profile: false,
            cursorRules: false,
            spokes: false,
            sources: ['data/*.json'],
          },
        },
      });

      const result = await compileAgent(def, tmpDir);
      const dataSources = result.bootContext.sources.filter((s) => s.includes('data/'));
      expect(dataSources.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('dynamic block resolution', () => {
    it('resolves module files for page origins', async () => {
      // Create a module with a source file
      const moduleDir = path.join(tmpDir, 'modules', 'releases');
      await fs.mkdir(moduleDir, { recursive: true });
      await fs.writeFile(path.join(moduleDir, 'index.js'), 'console.log("releases");');

      const def = baseDef({
        context: {
          blocks: [{ id: 'detail', source: 'dynamic' }],
        },
      });

      const result = await compileAgent(def, tmpDir, {
        source: 'page',
        entityId: 'releases/overview',
      });

      const block = result.contextBlocks.get('detail');
      expect(block).toBeDefined();
      expect(block!.content).toContain('releases');
      expect(block!.source).toBe('dynamic');
    });

    it('returns nothing for dynamic blocks without origin', async () => {
      const def = baseDef({
        context: {
          blocks: [{ id: 'detail', source: 'dynamic' }],
        },
      });

      const result = await compileAgent(def, tmpDir);
      expect(result.contextBlocks.has('detail')).toBe(false);
    });

    it('rejects path traversal in module names', async () => {
      const def = baseDef({
        context: {
          blocks: [{ id: 'detail', source: 'dynamic' }],
        },
      });

      const result = await compileAgent(def, tmpDir, {
        source: 'page',
        entityId: '../../etc/passwd',
      });

      expect(result.contextBlocks.has('detail')).toBe(false);
    });
  });
});
