import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverAndAdapt } from '../../src/adapter/index.js';
import { startWatcher } from '../../src/server/watcher.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
const state = vi.hoisted(() => ({
  notify: undefined as undefined | ((event: string, filename: string) => void),
}));
vi.mock('node:fs', () => ({
  watch: (
    _root: string,
    _options: unknown,
    listener: (event: string, filename: string) => void,
  ) => {
    state.notify = listener;
    return { on: vi.fn(), close: vi.fn() };
  },
}));

import type { ContexGinServer } from '../../src/server/app.js';

it('respects ignored adapter context files and watches their updates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-discovery-'));
  const file = path.join(root, 'context', 'entities.yaml');
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(
    file,
    'entities:\n  user:\n    fields:\n      - name: id\n        type: string\n',
  );
  await fs.writeFile(path.join(root, '.centaurignore'), 'context/**\n');
  expect((await discoverAndAdapt(root)).some((n) => n.origin.source === file)).toBe(false);
  const rebuild = vi.fn(async () => {});
  const watcher = startWatcher({ rebuild } as unknown as ContexGinServer, {
    ...DEFAULT_CONFIG,
    roots: [root],
    debounceMs: 10,
  });
  try {
    state.notify?.('change', path.relative(root, file));
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalled(), { timeout: 2000 });
  } finally {
    watcher.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
