import type { Claim } from './types.js';

/** Patterns that look like shell commands, not file paths */
const COMMAND_PATTERNS = [
  /^(npm|npx|git|yarn|pnpm|pip|python|node|cargo|go|make|docker)\b/,
  /^(cd|ls|cat|echo|rm|mv|cp|mkdir|chmod|chown|curl|wget)\b/,
  /^(export|source|set|unset)\b/,
];

/** Check if a backtick-enclosed string looks like a file/directory path */
function isPathLike(text: string): boolean {
  // Skip URLs
  if (/^https?:\/\//.test(text)) return false;
  if (/^[a-z]+:\/\//.test(text)) return false;

  // Skip shell commands
  if (COMMAND_PATTERNS.some((p) => p.test(text))) return false;

  // Skip single words without path separators or extensions (likely code references)
  if (!text.includes('/') && !text.includes('.') && !text.includes('\\')) return false;

  // Skip things that look like code (contain spaces, operators, etc.)
  if (/\s/.test(text) && !text.startsWith('./') && !text.startsWith('../')) return false;

  // Must have a path-like structure
  return /[a-zA-Z0-9_\-.]+(\/[a-zA-Z0-9_\-.]+)*\/?/.test(text);
}

/**
 * Extract testable claims from a context file.
 *
 * Patterns detected:
 * - File paths in backticks: `path/to/file` -> file_exists claim
 * - Directory references: `spoke_name/` -> directory_exists claim
 * - Table rows with paths (e.g., entry points tables)
 * - "Entry points" section -> entry_point claims
 */
export function extractClaims(content: string, sourcePath: string): Claim[] {
  const claims: Claim[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let inEntryPointsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Track code block boundaries
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip code block content
    if (inCodeBlock) continue;

    // Track entry points section
    if (/^#{1,6}\s+.*[Ee]ntry\s*[Pp]oint/i.test(line)) {
      inEntryPointsSection = true;
      continue;
    }
    // Exit entry points section on next heading
    if (/^#{1,6}\s+/.test(line) && inEntryPointsSection) {
      inEntryPointsSection = false;
    }

    // Extract backtick-enclosed paths
    const backtickPattern = /`([^`]+)`/g;
    let match;

    while ((match = backtickPattern.exec(line)) !== null) {
      const text = match[1].trim();

      if (!isPathLike(text)) continue;

      if (inEntryPointsSection) {
        claims.push({
          source: sourcePath,
          assertion: `Entry point ${text} exists`,
          kind: 'entry_point',
          target: text,
          line: lineNumber,
        });
      } else if (text.endsWith('/')) {
        claims.push({
          source: sourcePath,
          assertion: `Directory ${text} exists`,
          kind: 'directory_exists',
          target: text,
          line: lineNumber,
        });
      } else {
        claims.push({
          source: sourcePath,
          assertion: `File ${text} exists`,
          kind: 'file_exists',
          target: text,
          line: lineNumber,
        });
      }
    }

    // Extract paths from table rows in entry points section
    if (inEntryPointsSection && line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim());
      for (const cell of cells) {
        const cellBackticks = /`([^`]+)`/g;
        let cellMatch;
        while ((cellMatch = cellBackticks.exec(cell)) !== null) {
          const text = cellMatch[1].trim();
          if (isPathLike(text)) {
            // Only add if not already captured by the backtick scan above
            if (!claims.some((c) => c.target === text && c.line === lineNumber)) {
              claims.push({
                source: sourcePath,
                assertion: `Entry point ${text} exists`,
                kind: 'entry_point',
                target: text,
                line: lineNumber,
              });
            }
          }
        }
      }
    }
  }

  return claims;
}
