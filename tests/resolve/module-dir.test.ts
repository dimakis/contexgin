import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findModuleDir } from '../../src/resolve/module-dir.js';

describe('findModuleDir', () => {
  it('accepts module locations but rejects generated top-level directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-module-'));
    try {
      for (const dir of [
        'modules/releases',
        'src/modules/team',
        'dashboard',
        'node_modules',
        'dist',
      ]) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
      }
      expect(await findModuleDir('releases', root)).toBe(path.join(root, 'modules/releases'));
      expect(await findModuleDir('team', root)).toBe(path.join(root, 'src/modules/team'));
      expect(await findModuleDir('dashboard', root)).toBe(path.join(root, 'dashboard'));
      expect(await findModuleDir('node_modules', root)).toBeUndefined();
      expect(await findModuleDir('dist', root)).toBeUndefined();
      expect(await findModuleDir('../dashboard', root)).toBeUndefined();
      expect(await findModuleDir('node_modules/pkg', root)).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
