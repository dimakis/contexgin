import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadIgnorePatterns, shouldIgnore } from '../../src/graph/ignore.js';

describe('Ignore patterns', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-ignore-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadIgnorePatterns', () => {
    it('applies default patterns when no file exists', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(patterns.hasFile).toBe(false);
      expect(patterns.root).toBe(tmpDir);
    });

    it('loads patterns from .centaurignore file', async () => {
      await fs.writeFile(path.join(tmpDir, '.centaurignore'), 'data/\n*.parquet\n');
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(patterns.hasFile).toBe(true);
    });

    it('ignores comments and blank lines in .centaurignore', async () => {
      await fs.writeFile(
        path.join(tmpDir, '.centaurignore'),
        '# This is a comment\n\ndata/\n\n# Another comment\n',
      );
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(patterns.hasFile).toBe(true);
      expect(shouldIgnore('data/file.txt', patterns)).toBe(true);
      // Comments themselves are not patterns
      expect(shouldIgnore('# This is a comment', patterns)).toBe(false);
    });
  });

  describe('shouldIgnore (default patterns)', () => {
    it('ignores .git/', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('.git/config', patterns)).toBe(true);
      expect(shouldIgnore('.git/', patterns)).toBe(true);
    });

    it('ignores node_modules/', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('node_modules/package/index.js', patterns)).toBe(true);
    });

    it('ignores __pycache__/', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('__pycache__/module.cpython-312.pyc', patterns)).toBe(true);
    });

    it('ignores .pyc files', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('module.pyc', patterns)).toBe(true);
    });

    it('ignores .venv/', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('.venv/lib/python3.12/site.py', patterns)).toBe(true);
    });

    it('ignores dist/', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('dist/index.js', patterns)).toBe(true);
    });

    it('ignores .claude/', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('.claude/worktrees/', patterns)).toBe(true);
    });

    it('does NOT ignore regular directories', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('src/', patterns)).toBe(false);
      expect(shouldIgnore('lib/utils.ts', patterns)).toBe(false);
    });
  });

  describe('shouldIgnore (custom patterns)', () => {
    it('respects custom directory patterns', async () => {
      await fs.writeFile(path.join(tmpDir, '.centaurignore'), 'data/\nlogs/\n');
      const patterns = await loadIgnorePatterns(tmpDir);

      expect(shouldIgnore('data/file.parquet', patterns)).toBe(true);
      expect(shouldIgnore('logs/app.log', patterns)).toBe(true);
      expect(shouldIgnore('src/main.ts', patterns)).toBe(false);
    });

    it('respects custom glob patterns', async () => {
      await fs.writeFile(path.join(tmpDir, '.centaurignore'), '*.parquet\n*.log\n');
      const patterns = await loadIgnorePatterns(tmpDir);

      expect(shouldIgnore('data.parquet', patterns)).toBe(true);
      expect(shouldIgnore('app.log', patterns)).toBe(true);
      expect(shouldIgnore('app.ts', patterns)).toBe(false);
    });

    it('combines default + custom patterns', async () => {
      await fs.writeFile(path.join(tmpDir, '.centaurignore'), 'data/\n');
      const patterns = await loadIgnorePatterns(tmpDir);

      // Default still works
      expect(shouldIgnore('node_modules/foo', patterns)).toBe(true);
      // Custom also works
      expect(shouldIgnore('data/file.parquet', patterns)).toBe(true);
    });
  });

  describe('path normalization', () => {
    it('handles paths with leading ./', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('./node_modules/foo', patterns)).toBe(true);
    });

    it('handles paths with leading /', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('/node_modules/foo', patterns)).toBe(true);
    });

    it('handles empty path', async () => {
      const patterns = await loadIgnorePatterns(tmpDir);
      expect(shouldIgnore('', patterns)).toBe(false);
    });
  });
});
