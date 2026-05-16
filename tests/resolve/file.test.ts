import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { fileResolver } from '../../src/resolve/file.js';
import { findResolver } from '../../src/resolve/registry.js';
import type { ContextSource } from '../../src/compiler/types.js';

describe('fileResolver', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-resolver-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('returns true for file origin', () => {
      expect(fileResolver.canHandle({ source: 'file' })).toBe(true);
    });

    it('returns false for chat origin', () => {
      expect(fileResolver.canHandle({ source: 'chat' })).toBe(false);
    });

    it('returns false for telos origin', () => {
      expect(fileResolver.canHandle({ source: 'telos' })).toBe(false);
    });
  });

  describe('registry integration', () => {
    it('findResolver returns fileResolver for file origin', () => {
      const resolver = findResolver({ source: 'file', entityId: '/some/path' });
      expect(resolver).toBe(fileResolver);
    });
  });

  describe('resolve', () => {
    it('returns empty manifest when entityId is missing', async () => {
      const manifest = await fileResolver.resolve({ source: 'file' }, tmpDir, []);
      expect(manifest).toEqual({});
    });

    it('returns empty manifest for root-level file (no spoke)', async () => {
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# readme');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(tmpDir, 'README.md') },
        tmpDir,
        [],
      );
      expect(manifest).toEqual({});
    });

    it('returns taskHint with spoke name for spoke file', async () => {
      const spokeDir = path.join(tmpDir, 'jira_process');
      await fs.mkdir(spokeDir, { recursive: true });
      await fs.writeFile(path.join(spokeDir, 'fetch.py'), '# script');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(spokeDir, 'fetch.py') },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working in spoke: jira_process');
      expect(manifest.taskHint).toContain('File: jira_process/fetch.py');
    });

    it('includes purpose from spoke CONSTITUTION.md', async () => {
      const spokeDir = path.join(tmpDir, 'command_center');
      await fs.mkdir(spokeDir, { recursive: true });
      await fs.writeFile(
        path.join(spokeDir, 'CONSTITUTION.md'),
        '# Command Center\n\nOperational scripts and daily workflow automation for the management hub.',
      );
      await fs.writeFile(path.join(spokeDir, 'morning.py'), '# script');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(spokeDir, 'morning.py') },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working in spoke: command_center');
      expect(manifest.taskHint).toContain('Purpose:');
      expect(manifest.taskHint).toContain('Operational scripts');
    });

    it('adds spoke CONSTITUTION as additional source', async () => {
      const spokeDir = path.join(tmpDir, 'mgmt_lib');
      await fs.mkdir(spokeDir, { recursive: true });
      await fs.writeFile(path.join(spokeDir, 'CONSTITUTION.md'), '# Mgmt Lib\n\nAgent library.');
      await fs.writeFile(path.join(spokeDir, 'agent.py'), '# agent');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(spokeDir, 'agent.py') },
        tmpDir,
        [],
      );

      expect(manifest.sources).toHaveLength(1);
      expect(manifest.sources![0].relativePath).toBe(path.join('mgmt_lib', 'CONSTITUTION.md'));
      expect(manifest.sources![0].kind).toBe('constitution');
    });

    it('does not duplicate spoke CONSTITUTION already in defaults', async () => {
      const spokeDir = path.join(tmpDir, 'mgmt_lib');
      await fs.mkdir(spokeDir, { recursive: true });
      const constitutionPath = path.join(spokeDir, 'CONSTITUTION.md');
      await fs.writeFile(constitutionPath, '# Mgmt Lib');
      await fs.writeFile(path.join(spokeDir, 'agent.py'), '# agent');

      const defaultSources: ContextSource[] = [
        {
          path: constitutionPath,
          kind: 'constitution',
          relativePath: path.join('mgmt_lib', 'CONSTITUTION.md'),
        },
      ];

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(spokeDir, 'agent.py') },
        tmpDir,
        defaultSources,
      );

      // Should not add duplicate
      expect(manifest.sources).toBeUndefined();
    });

    it('works without spoke CONSTITUTION (no source augmentation)', async () => {
      const spokeDir = path.join(tmpDir, 'scripts');
      await fs.mkdir(spokeDir, { recursive: true });
      await fs.writeFile(path.join(spokeDir, 'run.sh'), '#!/bin/bash');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(spokeDir, 'run.sh') },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working in spoke: scripts');
      expect(manifest.sources).toBeUndefined();
    });

    it('skips hidden directories', async () => {
      const hiddenDir = path.join(tmpDir, '.git');
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(path.join(hiddenDir, 'config'), 'content');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(hiddenDir, 'config') },
        tmpDir,
        [],
      );
      expect(manifest).toEqual({});
    });

    it('skips node_modules', async () => {
      const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
      await fs.mkdir(nmDir, { recursive: true });
      await fs.writeFile(path.join(nmDir, 'index.js'), '// pkg');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(nmDir, 'index.js') },
        tmpDir,
        [],
      );
      expect(manifest).toEqual({});
    });

    it('handles deeply nested files (maps to top-level spoke)', async () => {
      const deepDir = path.join(tmpDir, 'command_center', 'lib', 'utils');
      await fs.mkdir(deepDir, { recursive: true });
      await fs.writeFile(path.join(deepDir, 'helper.py'), '# helper');

      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: path.join(deepDir, 'helper.py') },
        tmpDir,
        [],
      );

      expect(manifest.taskHint).toContain('Working in spoke: command_center');
      expect(manifest.taskHint).toContain('File: command_center/lib/utils/helper.py');
    });

    it('handles file outside workspace root', async () => {
      const manifest = await fileResolver.resolve(
        { source: 'file', entityId: '/etc/passwd' },
        tmpDir,
        [],
      );
      expect(manifest).toEqual({});
    });
  });
});
