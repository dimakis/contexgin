import * as fs from 'node:fs/promises';
import type {
  Constitution,
  DeclaredNode,
  EntryPoint,
  Dependency,
  Boundary,
  SpokeDeclaration,
  ConfidentialityLevel,
} from './types.js';

/**
 * Parse a CONSTITUTION.md file into a structured Constitution.
 *
 * Extracts from structured sections (tables, lists) — not prose mining.
 * The directory semantics table is the canonical structural declaration.
 */
export async function parseConstitution(
  filePath: string,
  nodeId: string = '',
): Promise<Constitution> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseConstitutionContent(content, filePath, nodeId);
}

/**
 * Parse constitution content (for testing without filesystem).
 */
export function parseConstitutionContent(
  content: string,
  sourcePath: string,
  nodeId: string = '',
): Constitution {
  return {
    sourcePath,
    purpose: extractPurpose(content),
    tree: extractDirectoryTree(content),
    entryPoints: extractEntryPoints(content, nodeId),
    dependencies: extractDependencies(content, nodeId),
    boundaries: extractBoundaries(content, nodeId),
    principles: extractPrinciples(content),
    spokeDeclarations: extractSpokeDeclarations(content),
  };
}

// ── Section Extraction Helpers ───────────────────────────────────

/**
 * Find lines belonging to a section that matches a heading pattern.
 * Returns lines between the matching heading and the next heading of equal or higher level.
 */
function findSection(lines: string[], pattern: RegExp): string[] {
  let collecting = false;
  let headingLevel = 0;
  const result: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+/.exec(line);

    if (headingMatch && pattern.test(line)) {
      collecting = true;
      headingLevel = headingMatch[1].length;
      continue;
    }

    if (collecting && headingMatch && headingMatch[1].length <= headingLevel) {
      break;
    }

    if (collecting) {
      result.push(line);
    }
  }

  return result;
}

// ── Table Parsing ────────────────────────────────────────────────

interface TableRow {
  cells: string[];
}

/**
 * Parse markdown table rows from lines.
 * Skips header row and separator row. Returns data rows only.
 */
function parseTable(lines: string[]): TableRow[] {
  const rows: TableRow[] = [];
  let headerSeen = false;
  let separatorSeen = false;

  for (const line of lines) {
    if (!line.includes('|')) continue;

    const raw = line.split('|').map((c) => c.trim());

    // Handle both "|a|b|" (leading/trailing empty) and "a|b" (no leading pipe)
    let cells: string[];
    if (raw[0] === '' && raw[raw.length - 1] === '') {
      // Standard: | cell | cell | — drop leading and trailing empty strings
      cells = raw.slice(1, -1);
    } else if (raw[0] === '') {
      // Leading pipe only: | cell | cell
      cells = raw.slice(1);
    } else if (raw[raw.length - 1] === '') {
      // Trailing pipe only: cell | cell |
      cells = raw.slice(0, -1);
    } else {
      // No pipes on either side: cell | cell
      cells = raw;
    }

    if (cells.length === 0) continue;

    // Separator line (all dashes, colons, spaces)
    if (cells.every((c) => /^[-:\s]+$/.test(c))) {
      if (headerSeen) separatorSeen = true;
      continue;
    }

    if (!headerSeen) {
      headerSeen = true;
      continue; // skip header row
    }

    if (!separatorSeen) continue; // still before separator

    rows.push({ cells });
  }

  return rows;
}

/**
 * Find the first table in a set of section lines.
 */
function findFirstTable(sectionLines: string[]): TableRow[] {
  return parseTable(sectionLines);
}

// ── Purpose ──────────────────────────────────────────────────────

function extractPurpose(content: string): string {
  const lines = content.split('\n');
  const section = findSection(lines, /^#{1,6}\s+Purpose/i);

  for (const line of section) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return '';
}

// ── Directory Tree ───────────────────────────────────────────────

function extractDirectoryTree(content: string): DeclaredNode[] {
  const lines = content.split('\n');

  // Look for directory semantics/structure sections
  // Must start with "Directory" to avoid false matches like "Navigation Infrastructure"
  const section = findSection(lines, /^#{1,6}\s+Directory\b/i);

  const rows = findFirstTable(section);
  const nodes: DeclaredNode[] = [];

  for (const row of rows) {
    if (row.cells.length < 2) continue;

    const rawPath = stripBackticks(row.cells[0]);
    if (!rawPath) continue;

    // Skip self-referencing root entries like "professional/ (root)"
    if (/\(root\)/i.test(rawPath)) continue;

    // Strip other annotations from path
    const cleanPath = rawPath.replace(/\s*\(.*?\)\s*$/, '').trim();
    if (!cleanPath) continue;

    const description = row.cells[1];
    const type: 'file' | 'directory' = cleanPath.endsWith('/') ? 'directory' : 'file';
    const name = cleanPath.replace(/\/$/, '').split('/').pop() || cleanPath;

    nodes.push({ path: cleanPath, name, type, description });
  }

  return nodes;
}

// ── Entry Points ─────────────────────────────────────────────────

function extractEntryPoints(content: string, nodeId: string): EntryPoint[] {
  const lines = content.split('\n');
  const section = findSection(lines, /^#{1,6}\s+.*[Ee]ntry\s*[Pp]oint/i);
  const rows = findFirstTable(section);
  const entryPoints: EntryPoint[] = [];

  for (const row of rows) {
    if (row.cells.length < 2) continue;

    const command = stripBackticks(row.cells[0]);
    if (!command) continue;

    const description = row.cells[1];
    const name = command.split(/\s+/)[0].replace(/[()]/g, '');

    entryPoints.push({ name, command, description, sourceId: nodeId });
  }

  return entryPoints;
}

// ── Dependencies ─────────────────────────────────────────────────

function extractDependencies(content: string, nodeId: string): Dependency[] {
  const lines = content.split('\n');
  const section = findSection(lines, /^#{1,6}\s+.*[Dd]ependenc/i);
  const deps: Dependency[] = [];

  // Try table format first
  const rows = findFirstTable(section);
  if (rows.length > 0) {
    for (const row of rows) {
      if (row.cells.length < 1) continue;
      const target = stripBackticks(row.cells[0]);
      if (!target) continue;
      const description = row.cells.length > 1 ? row.cells[1] : undefined;
      deps.push({ from: nodeId, to: target, kind: 'depends_on', description });
    }
    return deps;
  }

  // Fall back to list format — first backtick ref per bullet is the target
  for (const line of section) {
    const match = /^\s*[-*]\s+(.+)/.exec(line);
    if (match) {
      const text = match[1];
      const firstRef = /`([^`]+)`/.exec(text);
      if (firstRef) {
        const target = firstRef[1].trim();
        if (target) {
          const description =
            text
              .replace(/`[^`]+`/g, '')
              .replace(/[-—,]/g, '')
              .trim() || undefined;
          deps.push({ from: nodeId, to: target, kind: 'depends_on', description });
        }
      } else {
        // No backtick references — use raw text
        const rawText = stripBackticks(text).trim();
        if (rawText) {
          deps.push({ from: nodeId, to: rawText, kind: 'depends_on' });
        }
      }
    }
  }

  return deps;
}

// ── Boundaries ───────────────────────────────────────────────────

function extractBoundaries(content: string, nodeId: string): Boundary[] {
  const lines = content.split('\n');
  const section = findSection(lines, /^#{1,6}\s+.*(boundar|confidential|excluded)/i);
  const boundaries: Boundary[] = [];

  // Boundaries are typically bullet lists, not tables
  const bulletItems: string[] = [];
  for (const line of section) {
    const match = /^\s*[-*]\s+(.+)/.exec(line);
    if (match) {
      bulletItems.push(match[1]);
    }
  }

  if (bulletItems.length > 0) {
    // Extract spoke references from bullet items
    const excludedFrom: string[] = [];
    for (const item of bulletItems) {
      // Look for backtick-enclosed spoke references
      const refs = [...item.matchAll(/`([^`]+\/)`/g)];
      for (const ref of refs) {
        excludedFrom.push(ref[1]);
      }
    }

    boundaries.push({
      spokeId: nodeId,
      level: inferConfidentialityLevel(section),
      description: bulletItems.join('; '),
      excludedFrom,
    });
  }

  return boundaries;
}

/**
 * Infer confidentiality level from section content and surrounding context.
 */
function inferConfidentialityLevel(sectionLines: string[]): ConfidentialityLevel {
  const text = sectionLines.join(' ').toLowerCase();

  if (text.includes('hard') || text.includes('never')) return 'hard';
  if (text.includes('soft') || text.includes('caution') || text.includes('careful')) return 'soft';
  return 'none';
}

// ── Principles ───────────────────────────────────────────────────

function extractPrinciples(content: string): string[] {
  const lines = content.split('\n');
  const section = findSection(lines, /^#{1,6}\s+.*[Pp]rinciple/i);
  const principles: string[] = [];

  for (const line of section) {
    // Sub-headings within principles section are principle names
    const headingMatch = /^#{1,6}\s+(.+)/.exec(line);
    if (headingMatch) {
      // Strip leading numbering like "1." or "3."
      const principle = headingMatch[1].replace(/^\d+\.\s*/, '').trim();
      if (principle) principles.push(principle);
    }
  }

  return principles;
}

// ── Spoke Declarations ───────────────────────────────────────────

function extractSpokeDeclarations(content: string): SpokeDeclaration[] {
  const lines = content.split('\n');

  // Only look for explicit spoke charter / sub-repo sections.
  // Architecture tables describe internal modules, not workspace-root spokes.
  const section = findSection(lines, /^#{1,6}\s+.*(spoke|sub-repo|charter)/i);

  const rows = findFirstTable(section);
  const declarations: SpokeDeclaration[] = [];

  for (const row of rows) {
    if (row.cells.length < 2) continue;

    const name = stripBackticks(row.cells[0]).replace(/\/$/, '').trim();
    if (!name) continue;

    // The purpose/description might be in different columns depending on layout
    // Common layouts:
    //   Sub-Repo | Audience | Governance | Purpose  (mgmt root)
    //   Spoke | Function | Input | Process | Output  (professional)
    //   Module | Responsibility                      (contexgin)

    let purpose = '';
    let governance: string | undefined;
    let audience: string | undefined;

    if (row.cells.length >= 4) {
      // Assume: Name | Audience | Governance | Purpose
      audience = row.cells[1];
      governance = row.cells[2];
      purpose = row.cells[3];
    } else if (row.cells.length === 3) {
      // Assume: Name | Something | Description
      purpose = row.cells[2];
      governance = row.cells[1];
    } else {
      purpose = row.cells[1];
    }

    declarations.push({
      name,
      purpose,
      governance,
      audience,
      confidentiality: 'none', // Default; override from boundaries section
    });
  }

  return declarations;
}

// ── Utilities ────────────────────────────────────────────────────

function stripBackticks(text: string): string {
  return text.replace(/`/g, '').trim();
}
