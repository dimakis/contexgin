import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Claim, DocContract, CountClaim, ListClaim } from './types.js';

// ── Contract Extraction ──────────────────────────────────────────

/**
 * Parse Documentation Contracts from a CONSTITUTION.md file.
 *
 * Expects a `## Documentation Contracts` section containing a markdown table:
 * | Document | Section | Claim | Strategy | Pattern | Path |
 */
export function extractDocContracts(constitutionContent: string): DocContract[] {
  const contracts: DocContract[] = [];
  const lines = constitutionContent.split('\n');

  let inSection = false;
  let inTable = false;
  let headerParsed = false;

  for (const line of lines) {
    // Detect the Documentation Contracts heading (## or ###)
    if (/^#{2,3}\s+Documentation Contracts\s*$/i.test(line)) {
      inSection = true;
      inTable = false;
      headerParsed = false;
      continue;
    }

    // Exit on next heading of same or higher level
    if (inSection && /^#{1,3}\s+/.test(line) && !/Documentation Contracts/i.test(line)) {
      break;
    }

    if (!inSection) continue;

    // Detect table rows (contain pipes)
    if (line.includes('|')) {
      // Split by pipe, drop first/last empty segments from leading/trailing pipes
      const rawCells = line.split('|').map((c) => c.trim());
      const cells =
        rawCells.length >= 2 && rawCells[0] === '' && rawCells[rawCells.length - 1] === ''
          ? rawCells.slice(1, -1)
          : rawCells.filter((c) => c.length > 0);

      // Skip separator row (---|---|---...)
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        headerParsed = true;
        inTable = true;
        continue;
      }

      // Skip header row (before separator)
      if (!headerParsed) {
        inTable = true;
        continue;
      }

      // Parse data row
      if (inTable && cells.length >= 5) {
        const [document, section, claim, strategy, pattern, searchPath] = cells;

        const claimType = claim.toLowerCase().trim();
        if (claimType !== 'count' && claimType !== 'list_complete') continue;

        const strategyType = strategy.toLowerCase().trim();
        if (strategyType !== 'glob' && strategyType !== 'grep') continue;

        contracts.push({
          document: document.trim(),
          section: section.trim() || undefined,
          claim: claimType as 'count' | 'list_complete',
          verification: {
            strategy: strategyType as 'glob' | 'grep',
            pattern: pattern.trim().replace(/\\/g, ''),
            path: searchPath?.trim() || undefined,
          },
        });
      }
    } else if (inTable && line.trim() === '') {
      // Empty line after table ends it
      inTable = false;
    }
  }

  return contracts;
}

// ── Section Extraction ───────────────────────────────────────────

/**
 * Extract content of a specific section from a markdown document.
 * If no section is specified, returns the entire document content.
 */
function extractSection(content: string, section?: string): { text: string; startLine: number } {
  if (!section) {
    return { text: content, startLine: 1 };
  }

  const lines = content.split('\n');
  let inSection = false;
  let sectionLevel = 0;
  const sectionLines: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      if (inSection && level <= sectionLevel) {
        break;
      }

      if (title.toLowerCase() === section.toLowerCase()) {
        inSection = true;
        sectionLevel = level;
        startLine = i + 1; // 1-indexed
        continue;
      }
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return { text: sectionLines.join('\n'), startLine };
}

// ── Count Extraction ─────────────────────────────────────────────

/** Pattern: "N modules", "33 files", "5 agents", etc. */
const COUNT_PATTERN =
  /\b(\d+)\s+(modules?|pages?|files?|agents?|tests?|skills?|endpoints?|spokes?|services?|scripts?|commands?|routes?|components?)\b/gi;

/**
 * Extract count claims from section text.
 * Finds patterns like "33 modules", "5 agents".
 */
function extractCountClaims(
  sectionText: string,
  sectionStartLine: number,
  contract: DocContract,
  documentPath: string,
): CountClaim[] {
  const claims: CountClaim[] = [];
  const lines = sectionText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    COUNT_PATTERN.lastIndex = 0;

    while ((match = COUNT_PATTERN.exec(line)) !== null) {
      const count = parseInt(match[1], 10);
      const noun = match[2].toLowerCase();

      claims.push({
        source: documentPath,
        assertion: `${documentPath} claims ${count} ${noun} matching ${contract.verification.pattern}`,
        kind: 'count_matches',
        target: contract.verification.pattern,
        line: sectionStartLine + i,
        expectedCount: count,
        noun,
      });
    }
  }

  return claims;
}

// ── List Extraction ──────────────────────────────────────────────

/**
 * Extract listed item names from section text.
 *
 * Detects:
 * - Markdown tables: extracts first column values
 * - Bullet lists: extracts first backtick or bold text
 */
function extractListItems(sectionText: string): string[] {
  const items: string[] = [];
  const lines = sectionText.split('\n');
  let inTable = false;
  let headerParsed = false;

  for (const line of lines) {
    // Table detection
    if (line.includes('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      // Separator row
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        headerParsed = true;
        inTable = true;
        continue;
      }

      // Header row (before separator)
      if (!headerParsed && inTable) {
        continue;
      }

      // Skip if this is the first pipe-row and we haven't seen a separator
      if (!headerParsed) {
        inTable = true;
        continue;
      }

      // Data row — extract first cell content
      if (inTable && cells.length > 0) {
        const firstCell = cells[0];
        // Try backtick content first, then bold, then raw text
        const backtickMatch = firstCell.match(/`([^`]+)`/);
        const boldMatch = firstCell.match(/\*\*([^*]+)\*\*/);
        const value = backtickMatch?.[1] ?? boldMatch?.[1] ?? firstCell;
        if (value.trim()) {
          items.push(value.trim());
        }
      }
    } else {
      if (inTable && line.trim() === '') {
        inTable = false;
        headerParsed = false;
      }

      // Bullet list detection
      const bulletMatch = line.match(/^\s*[-*+]\s+(.*)/);
      if (bulletMatch) {
        const bulletContent = bulletMatch[1];
        // Try backtick content first, then bold, then first word
        const backtickMatch = bulletContent.match(/`([^`]+)`/);
        const boldMatch = bulletContent.match(/\*\*([^*]+)\*\*/);
        if (backtickMatch) {
          items.push(backtickMatch[1].trim());
        } else if (boldMatch) {
          items.push(boldMatch[1].trim());
        }
        // If no backtick/bold, skip — too ambiguous to extract raw text from bullets
      }
    }
  }

  return items;
}

/**
 * Extract list completeness claims from section text.
 */
function extractListClaims(
  sectionText: string,
  sectionStartLine: number,
  contract: DocContract,
  documentPath: string,
): ListClaim[] {
  const items = extractListItems(sectionText);

  if (items.length === 0) return [];

  return [
    {
      source: documentPath,
      assertion: `${documentPath} lists ${items.length} items that should match ${contract.verification.pattern}`,
      kind: 'list_complete',
      target: contract.verification.pattern,
      line: sectionStartLine,
      listedItems: items,
    },
  ];
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Extract documentation claims based on contracts.
 *
 * For each contract:
 * 1. Read the referenced document
 * 2. Extract the referenced section (if any)
 * 3. Parse count or list claims from the section text
 */
export async function extractDocClaims(
  contracts: DocContract[],
  workspaceRoot: string,
): Promise<Claim[]> {
  const claims: Claim[] = [];

  for (const contract of contracts) {
    const docPath = path.resolve(workspaceRoot, contract.document);

    let content: string;
    try {
      content = await fs.readFile(docPath, 'utf-8');
    } catch {
      // Document doesn't exist — skip (the file_exists claim will catch this)
      continue;
    }

    const { text: sectionText, startLine } = extractSection(content, contract.section);

    if (!sectionText.trim()) continue;

    if (contract.claim === 'count') {
      claims.push(...extractCountClaims(sectionText, startLine, contract, contract.document));
    } else if (contract.claim === 'list_complete') {
      claims.push(...extractListClaims(sectionText, startLine, contract, contract.document));
    }
  }

  return claims;
}
