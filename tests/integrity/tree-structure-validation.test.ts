import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { extractTreeStructureClaim } from '../../src/integrity/claims.js';
import { validateClaim } from '../../src/integrity/validator.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-workspace');

describe('tree structure validation (end-to-end)', () => {
  it('validates a constitution tree against actual filesystem', async () => {
    const content = `## Architecture

\`\`\`
workspace/
├── src/                          ← Source code
│   └── compiler/                 ← Compiler module
├── CONSTITUTION.md
└── docs/                         ← Documentation (does not exist)
\`\`\`

## Directory Semantics

| Path | What belongs here |
|------|-------------------|
| \`src/\` | Source code |
`;
    const { treeClaim, externalClaims } = extractTreeStructureClaim(
      content,
      '/test/CONSTITUTION.md',
    );
    expect(treeClaim).not.toBeNull();
    expect(externalClaims).toHaveLength(0);

    const result = await validateClaim(treeClaim!, FIXTURE_ROOT);
    // docs/ doesn't exist in fixture, so should be invalid
    expect(result.valid).toBe(false);
    expect(result.message).toContain('docs/');
  });

  it('passes when all declared paths exist', async () => {
    const content = `\`\`\`
workspace/
├── src/                          ← Source code
│   └── compiler/                 ← Compiler module
└── CONSTITUTION.md
\`\`\`
`;
    const { treeClaim } = extractTreeStructureClaim(content, '/test/CONSTITUTION.md');
    expect(treeClaim).not.toBeNull();

    const result = await validateClaim(treeClaim!, FIXTURE_ROOT);
    expect(result.valid).toBe(true);
  });

  it('extracts and validates external references', async () => {
    const content = `\`\`\`
workspace/
├── src/
└── [external] ~/this-path-should-not-exist-12345/  ← Fake project
\`\`\`
`;
    const { externalClaims } = extractTreeStructureClaim(content, '/test/CONSTITUTION.md');
    expect(externalClaims).toHaveLength(1);

    const result = await validateClaim(externalClaims[0], FIXTURE_ROOT);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns null when no tree or table found', () => {
    const content = `## Purpose\n\nJust a simple doc with no structure declarations.`;
    const { treeClaim, externalClaims } = extractTreeStructureClaim(
      content,
      '/test/CONSTITUTION.md',
    );
    expect(treeClaim).toBeNull();
    expect(externalClaims).toHaveLength(0);
  });
});
