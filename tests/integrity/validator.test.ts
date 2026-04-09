import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { validateClaim, validateAll } from '../../src/integrity/validator.js';
import type { Claim } from '../../src/integrity/types.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../fixtures/sample-workspace');

describe('validateClaim', () => {
  it('validates file_exists against real file', async () => {
    const claim: Claim = {
      source: '/test/CONSTITUTION.md',
      assertion: 'File src/index.ts exists',
      kind: 'file_exists',
      target: 'src/index.ts',
      line: 1,
    };
    const result = await validateClaim(claim, FIXTURE_ROOT);
    expect(result.valid).toBe(true);
    expect(result.message).toContain('exists');
  });

  it('reports invalid for missing file', async () => {
    const claim: Claim = {
      source: '/test/CONSTITUTION.md',
      assertion: 'File src/nonexistent.ts exists',
      kind: 'file_exists',
      target: 'src/nonexistent.ts',
      line: 1,
    };
    const result = await validateClaim(claim, FIXTURE_ROOT);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('validates directory_exists', async () => {
    const claim: Claim = {
      source: '/test/CONSTITUTION.md',
      assertion: 'Directory src/ exists',
      kind: 'directory_exists',
      target: 'src/',
      line: 1,
    };
    const result = await validateClaim(claim, FIXTURE_ROOT);
    expect(result.valid).toBe(true);
  });
});

describe('validateAll', () => {
  it('produces drift report with summary stats', async () => {
    const claims: Claim[] = [
      {
        source: '/test/CONSTITUTION.md',
        assertion: 'File src/index.ts exists',
        kind: 'file_exists',
        target: 'src/index.ts',
        line: 1,
      },
      {
        source: '/test/CONSTITUTION.md',
        assertion: 'File src/missing.ts exists',
        kind: 'file_exists',
        target: 'src/missing.ts',
        line: 2,
      },
      {
        source: '/test/CONSTITUTION.md',
        assertion: 'Directory src/ exists',
        kind: 'directory_exists',
        target: 'src/',
        line: 3,
      },
    ];
    const report = await validateAll(claims, FIXTURE_ROOT);
    expect(report.summary.total).toBe(3);
    expect(report.summary.valid).toBe(2);
    expect(report.summary.invalid).toBe(1);
    expect(report.summary.byKind['file_exists']).toEqual({ total: 2, invalid: 1 });
    expect(report.summary.byKind['directory_exists']).toEqual({ total: 1, invalid: 0 });
  });

  it('separates valid and invalid claims', async () => {
    const claims: Claim[] = [
      {
        source: '/test/CONSTITUTION.md',
        assertion: 'File src/index.ts exists',
        kind: 'file_exists',
        target: 'src/index.ts',
        line: 1,
      },
      {
        source: '/test/CONSTITUTION.md',
        assertion: 'File src/missing.ts exists',
        kind: 'file_exists',
        target: 'src/missing.ts',
        line: 2,
      },
    ];
    const report = await validateAll(claims, FIXTURE_ROOT);
    expect(report.results).toHaveLength(2);
    expect(report.drift).toHaveLength(1);
    expect(report.drift[0].claim.target).toBe('src/missing.ts');
  });
});
