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

    if (!collecting && headingMatch && pattern.test(line)) {
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

function findSections(lines: string[], pattern: RegExp): string[] {
  let collecting = false;
  let headingLevel = 0;
  const result: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+/.exec(line);
    if (
      headingMatch &&
      pattern.test(line) &&
      (!collecting || headingMatch[1].length <= headingLevel)
    ) {
      collecting = true;
      headingLevel = headingMatch[1].length;
      result.push(line);
      continue;
    }
    if (collecting && headingMatch && headingMatch[1].length <= headingLevel) {
      collecting = false;
    }
    if (collecting) result.push(line);
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

    // Skip self-referencing root entries:
    // 1. Explicitly annotated with (root), e.g. "professional/ (root)"
    // 2. Bare "Root" (case-insensitive exact match) — a standalone entry
    //    named "Root" is always a self-reference. Paths containing "root"
    //    as a substring (e.g. "rootfs/", "root-config.yml") are NOT matched.
    if (/\(root\)/i.test(rawPath) || /^root$/i.test(rawPath)) continue;

    // Strip other annotations from path
    const cleanPath = rawPath.replace(/\s*\(.*?\)\s*$/, '').trim();
    if (!cleanPath) continue;

    const description = row.cells[1];

    // Split compound entries like ".env / .env.example" into separate paths
    const subPaths = cleanPath.includes(' / ')
      ? cleanPath.split(' / ').map((p) => p.trim())
      : [cleanPath];

    for (const subPath of subPaths) {
      if (!subPath) continue;
      const type: 'file' | 'directory' = subPath.endsWith('/') ? 'directory' : 'file';
      const name = subPath.replace(/\/$/, '').split('/').pop() || subPath;

      nodes.push({ path: subPath, name, type, description });
    }
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

  return deps;
}

// ── Boundaries ───────────────────────────────────────────────────

function extractBoundaries(content: string, nodeId: string): Boundary[] {
  const lines = content.split('\n');
  const boundaryHeading = /^#{1,6}\s+.*(boundar|confidential|excluded)/i;
  const section = findSections(lines, boundaryHeading);
  const boundaries: Boundary[] = [];
  const boundaryRootLevel = Math.min(
    ...section
      .filter((line) => boundaryHeading.test(line))
      .map((line) => /^#+/.exec(line)![0].length),
  );

  // Boundaries are typically bullet lists, not tables
  const bulletItems: Array<{ text: string; fallbackLevel: ConfidentialityLevel }> = [];
  let basePolicyLines: string[] = [];
  let activePolicyLines = [...basePolicyLines];
  let inSubsection = false;
  const policyByHeadingLevel = new Map<number, string[]>();
  let currentBullet: string | null = null;
  let currentBulletHasBlank = false;
  let currentBulletIndent = 0;
  let sawBullet = false;
  let inComment = false;
  const finishBullet = () => {
    if (!currentBullet) return;
    bulletItems.push({
      text: currentBullet,
      fallbackLevel: inferConfidentialityLevel(activePolicyLines),
    });
    currentBullet = null;
    currentBulletHasBlank = false;
    currentBulletIndent = 0;
  };
  for (const line of section) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--')) inComment = true;
    if (inComment) {
      if (trimmed.endsWith('-->')) inComment = false;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      finishBullet();
      const headingLevel = /^#+/.exec(trimmed)![0].length;
      if (headingLevel === boundaryRootLevel && boundaryHeading.test(line)) {
        basePolicyLines = [trimmed];
        activePolicyLines = basePolicyLines;
        inSubsection = false;
        policyByHeadingLevel.clear();
        policyByHeadingLevel.set(headingLevel, basePolicyLines);
        sawBullet = false;
        continue;
      }
      inSubsection = true;
      for (const level of policyByHeadingLevel.keys()) {
        if (level >= headingLevel) policyByHeadingLevel.delete(level);
      }
      const parentPolicy =
        [...policyByHeadingLevel.entries()]
          .filter(([level]) => level < headingLevel)
          .sort(([left], [right]) => right - left)[0]?.[1] ?? basePolicyLines;
      const explicitPolicy =
        inferConfidentialityLevel([trimmed]) !== 'none' ||
        /\b(shareable|public|unrestricted)\b/i.test(trimmed);
      activePolicyLines = explicitPolicy ? [trimmed] : [...parentPolicy, trimmed];
      policyByHeadingLevel.set(headingLevel, activePolicyLines);
      sawBullet = false;
      continue;
    }
    const match = /^(\s*)[-*]\s+(.+)/.exec(line);
    if (match && currentBullet && match[1].length > currentBulletIndent) {
      currentBullet += ` ${match[2]}`;
      currentBulletHasBlank = false;
    } else if (match) {
      finishBullet();
      currentBullet = match[2];
      currentBulletHasBlank = false;
      currentBulletIndent = match[1].length;
      sawBullet = true;
    } else if (currentBullet && !trimmed) {
      currentBulletHasBlank = true;
    } else if (currentBullet && (!currentBulletHasBlank || /^(?: {2,}|\t)\S/.test(line))) {
      // CommonMark permits paragraph continuation text without indentation,
      // and indented paragraphs after a blank. Preserve both forms.
      currentBullet += ` ${line.trim()}`;
      currentBulletHasBlank = false;
    } else if (currentBullet) {
      finishBullet();
      if (trimmed) activePolicyLines.push(trimmed);
      sawBullet = false;
    } else if (!sawBullet && trimmed) {
      activePolicyLines.push(trimmed);
      if (!inSubsection) basePolicyLines.push(trimmed);
    }
  }
  finishBullet();

  if (bulletItems.length > 0) {
    for (const item of bulletItems) {
      // Look for backtick-enclosed spoke references
      const refs = [...item.text.matchAll(/`([^`]+\/)`/g)];
      const itemLevel = inferConfidentialityLevel([item.text]);
      boundaries.push({
        spokeId: nodeId,
        level: itemLevel === 'none' ? item.fallbackLevel : itemLevel,
        description: item.text,
        excludedFrom: refs.map((ref) => ref[1]),
      });
    }
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
