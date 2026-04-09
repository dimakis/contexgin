import { describe, it, expect } from 'vitest';
import { extractClaims } from '../../src/integrity/claims.js';

describe('extractClaims', () => {
  it('extracts file paths from backticks', () => {
    const content = `The config lives at \`config/settings.json\` and the main entry is \`src/index.ts\`.`;
    const claims = extractClaims(content, '/test/CONSTITUTION.md');
    const fileClaims = claims.filter((c) => c.kind === 'file_exists');
    expect(fileClaims.length).toBeGreaterThanOrEqual(2);
    expect(fileClaims.some((c) => c.target === 'config/settings.json')).toBe(true);
    expect(fileClaims.some((c) => c.target === 'src/index.ts')).toBe(true);
  });

  it('extracts directory references', () => {
    const content = `Code is organised into \`src/compiler/\` and \`src/integrity/\` directories.`;
    const claims = extractClaims(content, '/test/CONSTITUTION.md');
    const dirClaims = claims.filter((c) => c.kind === 'directory_exists');
    expect(dirClaims.length).toBeGreaterThanOrEqual(2);
    expect(dirClaims.some((c) => c.target === 'src/compiler/')).toBe(true);
    expect(dirClaims.some((c) => c.target === 'src/integrity/')).toBe(true);
  });

  it('extracts entry points from table', () => {
    const content = `## Entry Points

| Command | Description |
|---------|-------------|
| \`./mgmt\` | Interactive CLI |
| \`refresh.sh\` | Full data refresh |
`;
    const claims = extractClaims(content, '/test/CONSTITUTION.md');
    const entryPoints = claims.filter((c) => c.kind === 'entry_point');
    expect(entryPoints.length).toBeGreaterThanOrEqual(2);
    expect(entryPoints.some((c) => c.target === './mgmt')).toBe(true);
    expect(entryPoints.some((c) => c.target === 'refresh.sh')).toBe(true);
  });

  it('ignores code examples and URLs', () => {
    const content = `Run \`npm install\` to set up.

Visit https://github.com/example/repo for docs.

\`\`\`bash
# This is a code example
cat /etc/hosts
echo "hello"
\`\`\`

See \`http://localhost:3000\` for the dev server.
`;
    const claims = extractClaims(content, '/test/CONSTITUTION.md');
    // Should not extract npm install as a file path
    expect(claims.some((c) => c.target === 'npm install')).toBe(false);
    // Should not extract URLs
    expect(claims.some((c) => c.target.includes('http'))).toBe(false);
    expect(claims.some((c) => c.target.includes('github.com'))).toBe(false);
    // Should not extract paths from code blocks
    expect(claims.some((c) => c.target === '/etc/hosts')).toBe(false);
  });

  it('records source and line numbers', () => {
    const content = `Line 1
Line 2
The file \`src/main.ts\` is important.
Line 4`;
    const claims = extractClaims(content, '/test/DOC.md');
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims[0].source).toBe('/test/DOC.md');
    expect(claims[0].line).toBe(3);
  });
});
