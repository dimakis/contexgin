import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const exec = promisify(execFile);
const CLI = path.join(import.meta.dirname, '../src/cli.ts');

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec('npx', ['tsx', CLI, ...args], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout || '', stderr: e.stderr || '', code: e.code || 1 };
  }
}

describe('CLI', () => {
  describe('help / usage', () => {
    it('prints usage with no arguments', async () => {
      const { stdout } = await run();
      expect(stdout).toContain('contexgin');
      expect(stdout).toContain('validate');
      expect(stdout).toContain('graph');
    });

    it('prints usage with --help', async () => {
      const { stdout } = await run('--help');
      expect(stdout).toContain('Commands:');
    });
  });

  describe('error cases', () => {
    it('exits 1 on unknown command', async () => {
      const { stderr, code } = await run('foobar');
      expect(code).not.toBe(0);
      expect(stderr).toContain('Unknown command');
    });

    it('exits 1 when validate has no roots', async () => {
      const { stderr, code } = await run('validate');
      expect(code).not.toBe(0);
      expect(stderr).toContain('Usage:');
    });

    it('exits 1 when graph has no roots', async () => {
      const { stderr, code } = await run('graph');
      expect(code).not.toBe(0);
      expect(stderr).toContain('Usage:');
    });
  });

  describe('validate command', () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-cli-test-'));
      await fs.writeFile(
        path.join(tmpDir, 'CONSTITUTION.md'),
        `# Test Workspace

## Purpose

A test workspace for CLI validation.

## Directory Semantics

| Path | What belongs here |
|------|------------------|
| \`src/\` | Source code |
`,
      );
      await fs.mkdir(path.join(tmpDir, 'src'));
    });

    it('validates a fixture workspace', async () => {
      const { stdout, code } = await run('validate', tmpDir);
      expect(code).toBe(0);
      expect(stdout).toContain('validated');
    });
  });

  describe('graph command', () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-cli-test-'));
      await fs.writeFile(
        path.join(tmpDir, 'CONSTITUTION.md'),
        `# Test Workspace

## Purpose

Graph test workspace.
`,
      );
    });

    it('prints graph summary', async () => {
      const { stdout, code } = await run('graph', tmpDir);
      expect(code).toBe(0);
      expect(stdout).toContain('Hub:');
    });
  });
});
