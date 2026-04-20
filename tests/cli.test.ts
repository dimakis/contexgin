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

/**
 * Run the CLI with a timeout (ms).  Useful for `serve` which runs
 * indefinitely — we only need to confirm it gets past arg parsing.
 * A null `code` means the process was killed by timeout (i.e. it was
 * still running, which implies arg parsing succeeded).
 */
async function runWithTimeout(
  timeoutMs: number,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const { execFile: execFileCb } = await import('node:child_process');
  return new Promise((resolve) => {
    execFileCb(
      'npx',
      ['tsx', CLI, ...args],
      {
        cwd: path.join(import.meta.dirname, '..'),
        env: { ...process.env, NO_COLOR: '1' },
        timeout: timeoutMs,
      },
      (err: unknown, stdout: string, stderr: string) => {
        if (err && (err as NodeJS.ErrnoException).killed) {
          // Killed by timeout — got past arg parsing and was running
          resolve({ stdout: stdout || '', stderr: stderr || '', code: null });
        } else if (err) {
          const e = err as { code: number };
          resolve({ stdout: stdout || '', stderr: stderr || '', code: e.code || 1 });
        } else {
          resolve({ stdout, stderr, code: 0 });
        }
      },
    );
  });
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

  describe('serve arg parsing', () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-cli-serve-'));
      await fs.writeFile(
        path.join(tmpDir, 'CONSTITUTION.md'),
        `# Serve Test\n\n## Purpose\n\nArg-parsing test workspace.\n`,
      );
    });

    it('does not treat flag values as roots', async () => {
      // serve with only flag values (no real roots) should error
      const { stderr, code } = await run('serve', '--port', '4195', '--db', '/tmp/graph.db');
      expect(code).not.toBe(0);
      expect(stderr).toContain('Usage:');
    });

    it('accepts mixed roots and flags', async () => {
      // serve <root> --port 0 --db /tmp/x should get past arg parsing
      const { stderr } = await runWithTimeout(
        3000,
        'serve',
        tmpDir,
        '--port',
        '0',
        '--db',
        '/tmp/contexgin-test.db',
      );
      expect(stderr).not.toContain('Usage:');
    }, 10_000);

    it('accepts interleaved flags before root', async () => {
      // serve --port 0 <root> should also work (flag before positional)
      const { stderr } = await runWithTimeout(3000, 'serve', '--port', '0', tmpDir);
      expect(stderr).not.toContain('Usage:');
    }, 10_000);
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
