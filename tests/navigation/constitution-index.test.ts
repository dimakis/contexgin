import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  indexConstitutions,
  extractPurpose,
  extractEntryPoints,
} from '../../src/navigation/constitution-index.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../fixtures/sample-workspace');

describe('extractPurpose', () => {
  it('extracts purpose from ## Purpose section', () => {
    const content = `# Project

## Purpose

A sample workspace for testing.

## Architecture

Some arch details.
`;
    const purpose = extractPurpose(content);
    expect(purpose).toBe('A sample workspace for testing.');
  });

  it('returns empty string when no purpose section', () => {
    const content = `# Project

## Architecture

Arch stuff.
`;
    const purpose = extractPurpose(content);
    expect(purpose).toBe('');
  });
});

describe('extractEntryPoints', () => {
  it('extracts entry points from table', () => {
    const content = `## Entry Points

| Command | Description |
|---------|-------------|
| \`src/index.ts\` | Main entry |
| \`./cli.sh\` | CLI interface |
`;
    const entryPoints = extractEntryPoints(content);
    expect(entryPoints).toContain('src/index.ts');
    expect(entryPoints).toContain('./cli.sh');
  });

  it('returns empty array when no entry points section', () => {
    const content = `# Project

## Architecture

Some stuff.
`;
    const entryPoints = extractEntryPoints(content);
    expect(entryPoints).toHaveLength(0);
  });
});

describe('indexConstitutions', () => {
  it('indexes constitutions in given roots', async () => {
    const entries = await indexConstitutions([FIXTURE_ROOT]);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const main = entries.find((e) => e.relativePath === 'CONSTITUTION.md');
    expect(main).toBeDefined();
    expect(main!.purpose).toContain('sample workspace');
  });

  it('extracts entry points from indexed constitutions', async () => {
    const entries = await indexConstitutions([FIXTURE_ROOT]);
    const main = entries.find((e) => e.relativePath === 'CONSTITUTION.md');
    expect(main).toBeDefined();
    expect(main!.entryPoints.length).toBeGreaterThanOrEqual(1);
  });

  it('derives spoke name from path', async () => {
    const entries = await indexConstitutions([FIXTURE_ROOT]);
    const main = entries.find((e) => e.relativePath === 'CONSTITUTION.md');
    expect(main).toBeDefined();
    expect(main!.spokeName).toBe('sample-workspace');
  });
});
