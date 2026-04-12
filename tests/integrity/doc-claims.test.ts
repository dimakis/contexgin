import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractDocContracts, extractDocClaims } from '../../src/integrity/doc-claims.js';
import type { DocContract, CountClaim, ListClaim } from '../../src/integrity/types.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../fixtures/doc-consistency');

describe('extractDocContracts', () => {
  it('parses contracts from CONSTITUTION.md table', async () => {
    const content = await fs.readFile(path.join(FIXTURE_ROOT, 'CONSTITUTION.md'), 'utf-8');
    const contracts = extractDocContracts(content);

    expect(contracts).toHaveLength(4);

    // First contract: count of modules
    expect(contracts[0]).toEqual({
      document: 'README.md',
      section: 'Modules',
      claim: 'count',
      verification: {
        strategy: 'glob',
        pattern: 'src/modules/*.ts',
        path: '.',
      },
    });

    // Second contract: list_complete of modules
    expect(contracts[1].claim).toBe('list_complete');
    expect(contracts[1].verification.pattern).toBe('src/modules/*.ts');

    // Third contract: count of agents
    expect(contracts[2].claim).toBe('count');
    expect(contracts[2].section).toBe('Agents');

    // Fourth contract: list_complete of agents
    expect(contracts[3].claim).toBe('list_complete');
    expect(contracts[3].section).toBe('Agents');
  });

  it('returns empty array when no Documentation Contracts section', () => {
    const content = `# My Project\n\n## Architecture\n\nSome text.\n`;
    const contracts = extractDocContracts(content);
    expect(contracts).toHaveLength(0);
  });

  it('ignores invalid claim types', () => {
    const content = `## Documentation Contracts

| Document | Section | Claim | Strategy | Pattern | Path |
|----------|---------|-------|----------|---------|------|
| README.md | Foo | invalid_type | glob | *.ts | . |
| README.md | Bar | count | glob | *.ts | . |
`;
    const contracts = extractDocContracts(content);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].claim).toBe('count');
  });

  it('ignores invalid strategy types', () => {
    const content = `## Documentation Contracts

| Document | Section | Claim | Strategy | Pattern | Path |
|----------|---------|-------|----------|---------|------|
| README.md | Foo | count | magic | *.ts | . |
`;
    const contracts = extractDocContracts(content);
    expect(contracts).toHaveLength(0);
  });

  it('handles missing section column gracefully', () => {
    const content = `## Documentation Contracts

| Document | Section | Claim | Strategy | Pattern | Path |
|----------|---------|-------|----------|---------|------|
| README.md |  | count | glob | *.ts | . |
`;
    const contracts = extractDocContracts(content);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].section).toBeUndefined();
  });

  it('stops parsing at next heading', () => {
    const content = `## Documentation Contracts

| Document | Section | Claim | Strategy | Pattern | Path |
|----------|---------|-------|----------|---------|------|
| README.md | Foo | count | glob | *.ts | . |

## Other Section

| Document | Section | Claim | Strategy | Pattern | Path |
|----------|---------|-------|----------|---------|------|
| README.md | Bar | count | glob | *.js | . |
`;
    const contracts = extractDocContracts(content);
    expect(contracts).toHaveLength(1);
  });
});

describe('extractDocClaims', () => {
  it('extracts count claims from referenced document section', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Modules',
        claim: 'count',
        verification: { strategy: 'glob', pattern: 'src/modules/*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const countClaim = claims[0] as CountClaim;
    expect(countClaim.kind).toBe('count_matches');
    expect(countClaim.expectedCount).toBe(3);
    expect(countClaim.noun).toBe('modules');
    expect(countClaim.target).toBe('src/modules/*.ts');
  });

  it('extracts list claims from table in referenced document', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Modules',
        claim: 'list_complete',
        verification: { strategy: 'glob', pattern: 'src/modules/*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const listClaim = claims[0] as ListClaim;
    expect(listClaim.kind).toBe('list_complete');
    expect(listClaim.listedItems).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('extracts list claims from bullet lists', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Agents',
        claim: 'list_complete',
        verification: { strategy: 'glob', pattern: 'src/agents/*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const listClaim = claims[0] as ListClaim;
    expect(listClaim.kind).toBe('list_complete');
    expect(listClaim.listedItems).toEqual(['scout', 'builder']);
  });

  it('extracts count claims from bullet list sections', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Agents',
        claim: 'count',
        verification: { strategy: 'glob', pattern: 'src/agents/*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const countClaim = claims[0] as CountClaim;
    expect(countClaim.kind).toBe('count_matches');
    expect(countClaim.expectedCount).toBe(2);
    expect(countClaim.noun).toBe('agents');
  });

  it('skips contracts for missing documents', async () => {
    const contracts: DocContract[] = [
      {
        document: 'NONEXISTENT.md',
        section: 'Foo',
        claim: 'count',
        verification: { strategy: 'glob', pattern: '*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims).toHaveLength(0);
  });

  it('skips contracts with empty sections', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Nonexistent Section',
        claim: 'count',
        verification: { strategy: 'glob', pattern: '*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims).toHaveLength(0);
  });

  it('propagates grep strategy to count claims', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Modules',
        claim: 'count',
        verification: { strategy: 'grep', pattern: 'MODULE_' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const countClaim = claims[0] as CountClaim;
    expect(countClaim.kind).toBe('count_matches');
    expect(countClaim.strategy).toBe('grep');
  });

  it('propagates grep strategy to list claims', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Agents',
        claim: 'list_complete',
        verification: { strategy: 'grep', pattern: 'AGENT_' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const listClaim = claims[0] as ListClaim;
    expect(listClaim.kind).toBe('list_complete');
    expect(listClaim.strategy).toBe('grep');
  });

  it('propagates searchPath from contract verification.path', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        section: 'Modules',
        claim: 'count',
        verification: { strategy: 'glob', pattern: '*.ts', path: 'src/modules' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    expect(claims.length).toBeGreaterThanOrEqual(1);

    const countClaim = claims[0] as CountClaim;
    expect(countClaim.searchPath).toBe('src/modules');
  });

  it('reads entire document when no section specified', async () => {
    const contracts: DocContract[] = [
      {
        document: 'README.md',
        claim: 'count',
        verification: { strategy: 'glob', pattern: 'src/modules/*.ts' },
      },
    ];

    const claims = await extractDocClaims(contracts, FIXTURE_ROOT);
    // Should find the "3 modules" mention anywhere in the doc
    expect(claims.length).toBeGreaterThanOrEqual(1);
    const countClaim = claims.find(
      (c) => c.kind === 'count_matches' && (c as CountClaim).expectedCount === 3,
    );
    expect(countClaim).toBeDefined();
  });
});
