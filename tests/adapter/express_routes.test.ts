import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { expressRoutesAdapter } from '../../src/adapter/express_routes.js';

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

describe('expressRoutesAdapter', () => {
  it('has format "express_routes"', () => {
    expect(expressRoutesAdapter.format).toBe('express_routes');
  });

  describe('canHandle', () => {
    it('handles JS files in server/ directories', () => {
      expect(expressRoutesAdapter.canHandle('/app/server/index.js')).toBe(true);
      expect(expressRoutesAdapter.canHandle('/app/server/api.ts')).toBe(true);
    });

    it('handles route/router files', () => {
      expect(expressRoutesAdapter.canHandle('/app/routes.js')).toBe(true);
      expect(expressRoutesAdapter.canHandle('/app/apiRouter.ts')).toBe(true);
    });

    it('rejects non-JS/TS files', () => {
      expect(expressRoutesAdapter.canHandle('/app/server/data.json')).toBe(false);
      expect(expressRoutesAdapter.canHandle('/app/server/README.md')).toBe(false);
    });

    it('rejects JS files not in server/ and without route in name', () => {
      expect(expressRoutesAdapter.canHandle('/app/utils/helpers.js')).toBe(false);
    });
  });

  describe('adapt', () => {
    it('extracts router.get/post/put/delete routes', async () => {
      const source = `
const express = require('express');
const router = express.Router();

router.get('/api/modules', getModules);
router.post('/api/modules/:id/enable', enableModule);
router.put('/api/settings', updateSettings);
router.delete('/api/cache', clearCache);

module.exports = router;
`;

      await withTempFile(source, 'server/api.js', async (filePath, dir) => {
        const nodes = await expressRoutesAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].type).toBe('structural');
        expect(nodes[0].tier).toBe('navigational');
        expect(nodes[0].content).toContain('`GET /api/modules`');
        expect(nodes[0].content).toContain('`POST /api/modules/:id/enable`');
        expect(nodes[0].content).toContain('`PUT /api/settings`');
        expect(nodes[0].content).toContain('`DELETE /api/cache`');
        expect(nodes[0].content).toContain('4 endpoint(s)');
      });
    });

    it('handles app.get/post patterns', async () => {
      const source = `
app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/api/chat', handleChat);
`;

      await withTempFile(source, 'server/app.js', async (filePath, dir) => {
        const nodes = await expressRoutesAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].content).toContain('`GET /health`');
        expect(nodes[0].content).toContain('`POST /api/chat`');
      });
    });

    it('returns empty for files with no routes', async () => {
      const source = `
const helper = require('./helper');
function doSomething() { return 42; }
module.exports = { doSomething };
`;

      await withTempFile(source, 'server/utils.js', async (filePath, dir) => {
        const nodes = await expressRoutesAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });

    it('handles router.use for middleware mounts', async () => {
      const source = `
router.use('/api/v2', v2Router);
router.get('/api/v1/status', getStatus);
`;

      await withTempFile(source, 'server/index.js', async (filePath, dir) => {
        const nodes = await expressRoutesAdapter.adapt(filePath, dir);
        expect(nodes[0].content).toContain('`USE /api/v2`');
        expect(nodes[0].content).toContain('`GET /api/v1/status`');
      });
    });

    it('sets correct origin', async () => {
      const source = `router.get('/test', handler);`;

      await withTempFile(source, 'server/routes.js', async (filePath, dir) => {
        const nodes = await expressRoutesAdapter.adapt(filePath, dir);
        expect(nodes[0].origin.format).toBe('express_routes');
        expect(nodes[0].origin.relativePath).toBe(path.join('server', 'routes.js'));
      });
    });
  });
});
