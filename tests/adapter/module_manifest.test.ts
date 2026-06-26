import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { moduleManifestAdapter } from '../../src/adapter/module_manifest.js';

async function withTempFile(
  content: string,
  filePath: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  const fullPath = path.join(dir, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  try {
    await fn(fullPath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe('moduleManifestAdapter', () => {
  it('has format "json_manifest"', () => {
    expect(moduleManifestAdapter.format).toBe('json_manifest');
  });

  describe('canHandle', () => {
    it('handles module.json files', () => {
      expect(moduleManifestAdapter.canHandle('module.json')).toBe(true);
      expect(moduleManifestAdapter.canHandle('/path/to/releases/module.json')).toBe(true);
    });

    it('rejects other JSON files', () => {
      expect(moduleManifestAdapter.canHandle('package.json')).toBe(false);
      expect(moduleManifestAdapter.canHandle('data.json')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts module name and description', async () => {
      const manifest = JSON.stringify({
        name: 'Releases',
        description: 'Track release versions and coverage across teams.',
      });

      await withTempFile(manifest, 'modules/releases/module.json', async (filePath, dir) => {
        const nodes = await moduleManifestAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].id).toBe('module-releases');
        expect(nodes[0].type).toBe('structural');
        expect(nodes[0].tier).toBe('navigational');
        expect(nodes[0].content).toContain('## Module: Releases');
        expect(nodes[0].content).toContain('Track release versions');
        expect(nodes[0].origin.format).toBe('json_manifest');
      });
    });

    it('extracts views', async () => {
      const manifest = JSON.stringify({
        name: 'Releases',
        views: [
          { name: 'overview', path: '/overview', description: 'Release summary' },
          { name: 'coverage', path: '/coverage' },
        ],
      });

      await withTempFile(manifest, 'modules/releases/module.json', async (filePath, dir) => {
        const nodes = await moduleManifestAdapter.adapt(filePath, dir);
        expect(nodes[0].content).toContain('### Views');
        expect(nodes[0].content).toContain('`overview` — Release summary');
        expect(nodes[0].content).toContain('`coverage`');
      });
    });

    it('extracts nav items', async () => {
      const manifest = JSON.stringify({
        name: 'Team Tracker',
        navItems: [
          { label: 'Teams', path: '/teams' },
          { label: 'Members', path: '/members' },
        ],
      });

      await withTempFile(manifest, 'modules/team-tracker/module.json', async (filePath, dir) => {
        const nodes = await moduleManifestAdapter.adapt(filePath, dir);
        expect(nodes[0].content).toContain('### Navigation');
        expect(nodes[0].content).toContain('Teams → `/teams`');
      });
    });

    it('falls back to directory name when name is missing', async () => {
      const manifest = JSON.stringify({ description: 'A module without a name.' });

      await withTempFile(manifest, 'modules/my-module/module.json', async (filePath, dir) => {
        const nodes = await moduleManifestAdapter.adapt(filePath, dir);
        expect(nodes[0].id).toBe('module-my-module');
        expect(nodes[0].content).toContain('## Module: my-module');
      });
    });

    it('includes defaultEnabled flag', async () => {
      const manifest = JSON.stringify({ name: 'AI Assistant', defaultEnabled: false });

      await withTempFile(manifest, 'modules/ai-assistant/module.json', async (filePath, dir) => {
        const nodes = await moduleManifestAdapter.adapt(filePath, dir);
        expect(nodes[0].content).toContain('**Enabled by default:** no');
      });
    });

    it('sets correct origin with relative path', async () => {
      const manifest = JSON.stringify({ name: 'Test' });

      await withTempFile(manifest, 'modules/test/module.json', async (filePath, dir) => {
        const nodes = await moduleManifestAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.relativePath).toBe(path.join('modules', 'test', 'module.json'));
      });
    });
  });
});
