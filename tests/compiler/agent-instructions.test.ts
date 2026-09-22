import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { compile, discoverSources } from '../../src/compiler/index.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-instructions-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function file(name: string, content: string) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await writeFile(join(root, name), content);
}
const run = (options = {}) => compile({ workspaceRoot: root, tokenBudget: 12000, ...options });

describe('canonical agent instructions', () => {
  it('discovers AGENTS and preserves preamble, headings, and reference lines', async () => {
    const content =
      'PREAMBLE_SENTINEL\n\n# Instructions\n\n## Required\n\nAGENTS_SENTINEL\nSee: keep-this-guidance\n';
    await file('AGENTS.md', content);
    const result = await run();
    expect(result.bootPayload).toContain(content.trim());
    expect(result.nodes?.[0].origin.format).toBe('agents_md');
    expect((await discoverSources(root)).map((s) => s.relativePath)).toContain('AGENTS.md');
  });
  it('preserves CLAUDE-only legacy behavior', async () => {
    await file('CLAUDE.md', '## Required\n\nLEGACY_SENTINEL');
    expect((await run()).bootPayload).toContain('LEGACY_SENTINEL');
  });
  it('uses whole-file canonical precedence, including distinct legacy sections', async () => {
    await file('AGENTS.md', '## Shared\n\nSHARED_SENTINEL\n\n## Canonical\n\nCANONICAL_SENTINEL');
    await file('CLAUDE.md', '## Shared\n\nSHARED_SENTINEL\n\n## Legacy\n\nLEGACY_ONLY');
    const result = await run();
    expect(result.bootPayload.match(/SHARED_SENTINEL/g)).toHaveLength(1);
    expect(result.bootPayload).toContain('CANONICAL_SENTINEL');
    expect(result.bootPayload).not.toContain('LEGACY_ONLY');
    expect(result.sources.map((s) => s.relativePath)).toEqual(['AGENTS.md']);
  });
  it('reads canonical content directly through repeated and cyclic import bridges', async () => {
    await file('CLAUDE.md', '@AGENTS.md\n@AGENTS.md\n@CLAUDE.md\n@../outside.md');
    await file('AGENTS.md', 'BRIDGE_SENTINEL\n@CLAUDE.md');
    const result = await run();
    expect(result.bootPayload.match(/BRIDGE_SENTINEL/g)).toHaveLength(1);
    expect(result.sources.map((s) => s.relativePath)).toEqual(['AGENTS.md']);
  });
  it('selects only root and ancestor instructions for an explicit directory scope', async () => {
    await file('AGENTS.md', 'ROOT_SENTINEL');
    await file('app/AGENTS.md', 'APP_SENTINEL');
    await file('app/deep/AGENTS.md', 'DEEP_SENTINEL');
    await file('other/AGENTS.md', 'OTHER_SENTINEL');
    const result = await run({ scopePath: 'app/deep' });
    for (const sentinel of ['ROOT_SENTINEL', 'APP_SENTINEL', 'DEEP_SENTINEL'])
      expect(result.bootPayload).toContain(sentinel);
    expect(result.bootPayload).not.toContain('OTHER_SENTINEL');
  });
  it('rejects out-of-workspace scopes and symlink instruction files', async () => {
    await expect(run({ scopePath: '../outside' })).rejects.toThrow(/scope/i);
    await file('target.md', 'LINK_SENTINEL');
    await symlink(join(root, 'target.md'), join(root, 'AGENTS.md'));
    await expect(run()).rejects.toThrow(/symlink/i);
  });
  it('fails explicitly when canonical guidance cannot fit', async () => {
    await file('AGENTS.md', 'REQUIRED_SENTINEL '.repeat(100));
    await expect(run({ tokenBudget: 10 })).rejects.toThrow(/required.*budget/i);
  });
  it('reserves budget for canonical guidance before ordinary knowledge', async () => {
    await file('AGENTS.md', 'REQUIRED_SENTINEL');
    await file('README.md', '## Architecture\n\n' + 'optional '.repeat(80));
    const result = await run({ tokenBudget: 40 });
    expect(result.bootPayload).toContain('REQUIRED_SENTINEL');
    expect(result.trimmed.length).toBeGreaterThan(0);
    expect(result.bootTokens).toBeLessThanOrEqual(40);
  });
  it('honors explicit required selectors for legacy content under pressure', async () => {
    await file(
      'CLAUDE.md',
      '## Security\n\n' + 'optional '.repeat(40) + '\n\n## Required\n\nKEEP_ME',
    );
    const result = await run({ tokenBudget: 30, required: [['Required']] });
    expect(result.bootPayload).toContain('KEEP_ME');
    await expect(run({ tokenBudget: 1, required: [['Required']] })).rejects.toThrow(
      /required.*budget/i,
    );
  });
  it('deduplicates repeated explicit source references', async () => {
    await file('AGENTS.md', 'ONCE_SENTINEL');
    const source = {
      path: join(root, 'AGENTS.md'),
      relativePath: 'AGENTS.md',
      kind: 'reference' as const,
    };
    const result = await run({ sources: [source, source] });
    expect(result.bootPayload.match(/ONCE_SENTINEL/g)).toHaveLength(1);
  });
});

describe('instruction edge cases', () => {
  it('applies canonical precedence to explicitly supplied source lists', async () => {
    await file('AGENTS.md', 'CANONICAL_EXPLICIT');
    await file('CLAUDE.md', '## Legacy\n\nLEGACY_EXPLICIT');
    const sources = ['CLAUDE.md', 'AGENTS.md'].map((name) => ({
      path: join(root, name),
      relativePath: name,
      kind: 'reference' as const,
    }));
    const result = await run({ sources });
    expect(result.bootPayload).toContain('CANONICAL_EXPLICIT');
    expect(result.bootPayload).not.toContain('LEGACY_EXPLICIT');
  });
  it('rejects missing required selectors rather than silently succeeding', async () => {
    await file('CLAUDE.md', '## Present\n\nPRESENT');
    await expect(run({ required: [['Missing']] })).rejects.toThrow(/required.*missing/i);
  });
  it('preserves the required marker through serialization and recompilation', async () => {
    await file('AGENTS.md', 'REQUIRED_AGAIN');
    const result = await run();
    await expect(run({ nodes: result.nodes, tokenBudget: 1 })).rejects.toThrow(/required.*budget/i);
  });
  it('does not fall back to stale CLAUDE when AGENTS is empty', async () => {
    await file('AGENTS.md', '');
    await file('CLAUDE.md', '## Old\n\nOLD');
    await expect(run()).rejects.toThrow(/empty/i);
  });
  it('keeps legacy one-level discovery deterministic and applies per-directory precedence', async () => {
    await file('z/AGENTS.md', 'Z_SENTINEL');
    await file('z/CLAUDE.md', '## Old\n\nOLD_Z');
    await file('a/CLAUDE.md', '## Legacy\n\nA_SENTINEL');
    const first = await run();
    expect(first.bootPayload).not.toContain('OLD_Z');
    expect(first.bootPayload.match(/Z_SENTINEL/g)).toHaveLength(1);
    expect(first.bootPayload).toContain('A_SENTINEL');
    expect((await run()).bootPayload).toBe(first.bootPayload);
  });
  it('rejects a symlinked directory scope', async () => {
    await file('actual/AGENTS.md', 'LINKED_SCOPE');
    await symlink(join(root, 'actual'), join(root, 'linked'));
    await expect(run({ scopePath: 'linked' })).rejects.toThrow(/scope.*symlink/i);
  });
});

it('counts separators between required files in the budget', async () => {
  await file('AGENTS.md', '# AA');
  await file('app/AGENTS.md', '# BB');
  await expect(run({ tokenBudget: 6 })).rejects.toThrow(/required.*budget/i);
});
