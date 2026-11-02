import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { pageResolver } from '../../src/resolve/page.js';
import type { SessionOrigin } from '../../src/resolve/types.js';
import type { ContextSource } from '../../src/compiler/types.js';

async function withTempWorkspace(
  setup: (root: string) => Promise<void>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-page-'));
  await setup(root);
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true });
  }
}

describe('pageResolver', () => {
  it('has source "page"', () => {
    expect(pageResolver.source).toBe('page');
  });

  describe('canHandle', () => {
    it('handles page origins', () => {
      expect(pageResolver.canHandle({ source: 'page' })).toBe(true);
    });

    it('rejects other origins', () => {
      expect(pageResolver.canHandle({ source: 'chat' })).toBe(false);
      expect(pageResolver.canHandle({ source: 'file' })).toBe(false);
    });
  });

  describe('resolve', () => {
    it('returns empty manifest when no entityId', async () => {
      const origin: SessionOrigin = { source: 'page' };
      const result = await pageResolver.resolve(origin, '/tmp', []);
      expect(result).toEqual({});
    });

    it('returns taskHint with module name when module dir not found', async () => {
      await withTempWorkspace(
        async () => {},
        async (root) => {
          const origin: SessionOrigin = {
            source: 'page',
            entityId: 'nonexistent/view',
          };
          const result = await pageResolver.resolve(origin, root, []);
          expect(result.taskHint).toContain('nonexistent');
          expect(result.taskHint).toContain('not found');
        },
      );
    });

    it('discovers module.json as source', async () => {
      await withTempWorkspace(
        async (root) => {
          const moduleDir = path.join(root, 'modules', 'releases');
          await fs.mkdir(moduleDir, { recursive: true });
          await fs.writeFile(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({ name: 'Releases' }),
          );
        },
        async (root) => {
          const origin: SessionOrigin = {
            source: 'page',
            entityId: 'releases/coverage',
          };
          const result = await pageResolver.resolve(origin, root, []);
          expect(result.taskHint).toContain('releases');
          expect(result.taskHint).toContain('coverage');
          expect(result.sources).toBeDefined();
          expect(result.sources!.some((s) => s.path.includes('module.json'))).toBe(true);
        },
      );
    });

    it('discovers server/ JS files as sources', async () => {
      await withTempWorkspace(
        async (root) => {
          const serverDir = path.join(root, 'modules', 'releases', 'server');
          await fs.mkdir(serverDir, { recursive: true });
          await fs.writeFile(path.join(serverDir, 'api.js'), 'router.get("/test", handler);');
          await fs.writeFile(path.join(serverDir, 'utils.ts'), 'export const x = 1;');
        },
        async (root) => {
          const origin: SessionOrigin = {
            source: 'page',
            entityId: 'releases',
          };
          const result = await pageResolver.resolve(origin, root, []);
          expect(result.sources!.some((s) => s.path.includes('api.js'))).toBe(true);
          expect(result.sources!.some((s) => s.path.includes('utils.ts'))).toBe(true);
        },
      );
    });

    it('discovers data/ JSON files as sources', async () => {
      await withTempWorkspace(
        async (root) => {
          const dataDir = path.join(root, 'modules', 'releases', 'data');
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(path.join(dataDir, 'versions.json'), '[]');
        },
        async (root) => {
          const origin: SessionOrigin = {
            source: 'page',
            entityId: 'releases',
          };
          const result = await pageResolver.resolve(origin, root, []);
          expect(result.sources!.some((s) => s.path.includes('versions.json'))).toBe(true);
        },
      );
    });

    it('parses hash routes with leading #/', async () => {
      await withTempWorkspace(
        async (root) => {
          const moduleDir = path.join(root, 'modules', 'team-tracker');
          await fs.mkdir(moduleDir, { recursive: true });
          await fs.writeFile(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({ name: 'Team Tracker' }),
          );
        },
        async (root) => {
          const origin: SessionOrigin = {
            source: 'page',
            entityId: '#/team-tracker/members',
          };
          const result = await pageResolver.resolve(origin, root, []);
          expect(result.taskHint).toContain('team-tracker');
          expect(result.taskHint).toContain('members');
        },
      );
    });

    it('deduplicates sources already in defaults', async () => {
      await withTempWorkspace(
        async (root) => {
          const moduleDir = path.join(root, 'modules', 'releases');
          await fs.mkdir(moduleDir, { recursive: true });
          await fs.writeFile(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({ name: 'Releases' }),
          );
        },
        async (root) => {
          const manifestPath = path.join(root, 'modules', 'releases', 'module.json');
          const defaultSources: ContextSource[] = [
            { path: manifestPath, kind: 'reference', relativePath: 'modules/releases/module.json' },
          ];
          const origin: SessionOrigin = {
            source: 'page',
            entityId: 'releases',
          };
          const result = await pageResolver.resolve(origin, root, defaultSources);
          // No new sources added since the only one is already included
          expect(result.sources).toBeUndefined();
          // But taskHint should still be present
          expect(result.taskHint).toContain('releases');
        },
      );
    });

    it('includes view in taskHint when present', async () => {
      await withTempWorkspace(
        async (root) => {
          await fs.mkdir(path.join(root, 'modules', 'releases'), { recursive: true });
        },
        async (root) => {
          const origin: SessionOrigin = {
            source: 'page',
            entityId: 'releases/coverage',
          };
          const result = await pageResolver.resolve(origin, root, []);
          expect(result.taskHint).toContain('Current view: coverage');
        },
      );
    });
  });
});
