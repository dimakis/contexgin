import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ConstitutionEntry } from './types.js';
import { parseMarkdown } from '../compiler/parser.js';

/**
 * Extract purpose from a constitution (first paragraph after "## Purpose").
 */
export function extractPurpose(content: string): string {
  const lines = content.split('\n');
  let inPurpose = false;

  for (const line of lines) {
    if (/^##\s+Purpose/i.test(line)) {
      inPurpose = true;
      continue;
    }

    if (inPurpose) {
      // Stop at next heading
      if (/^#{1,6}\s+/.test(line)) break;

      const trimmed = line.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return '';
}

/**
 * Extract entry points from a constitution.
 * Looks for backtick-enclosed items in the "Entry Points" section table.
 */
export function extractEntryPoints(content: string): string[] {
  const lines = content.split('\n');
  let inEntryPoints = false;
  const entryPoints: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s+.*[Ee]ntry\s*[Pp]oint/i.test(line)) {
      inEntryPoints = true;
      continue;
    }

    if (inEntryPoints && /^#{1,6}\s+/.test(line)) {
      break;
    }

    if (inEntryPoints && line.includes('|')) {
      const backtickPattern = /`([^`]+)`/g;
      let match;
      while ((match = backtickPattern.exec(line)) !== null) {
        const text = match[1].trim();
        // Skip table headers/separators
        if (text && !text.match(/^-+$/) && text !== 'Command' && text !== 'Export') {
          entryPoints.push(text);
        }
      }
    }
  }

  return entryPoints;
}

/**
 * Extract directory semantics from a constitution.
 * Looks for directory descriptions in tables or lists.
 */
function extractDirectorySemantics(content: string): Map<string, string> {
  const semantics = new Map<string, string>();
  const lines = content.split('\n');
  let inDirectorySection = false;

  for (const line of lines) {
    if (/^#{1,6}\s+.*(directory|structure|semantics)/i.test(line)) {
      inDirectorySection = true;
      continue;
    }

    if (inDirectorySection && /^#{1,6}\s+/.test(line)) {
      break;
    }

    if (inDirectorySection && line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 2) {
        const dir = cells[0].replace(/`/g, '').trim();
        const desc = cells[1].replace(/`/g, '').trim();
        if (dir && desc && !dir.match(/^-+$/) && dir !== 'Directory') {
          semantics.set(dir, desc);
        }
      }
    }
  }

  return semantics;
}

/**
 * Extract dependencies from a constitution.
 */
function extractDependencies(content: string): string[] {
  const deps: string[] = [];
  const lines = content.split('\n');
  let inDeps = false;

  for (const line of lines) {
    if (/^#{1,6}\s+.*[Dd]ependenc/i.test(line)) {
      inDeps = true;
      continue;
    }

    if (inDeps && /^#{1,6}\s+/.test(line)) {
      break;
    }

    if (inDeps) {
      const match = /^\s*[-*]\s+(.+)/.exec(line);
      if (match) {
        deps.push(match[1].replace(/`/g, '').trim());
      }
    }
  }

  return deps;
}

/**
 * Extract excluded spokes from a constitution.
 */
function extractExcluded(content: string): string[] {
  const excluded: string[] = [];
  const lines = content.split('\n');
  let inExcluded = false;

  for (const line of lines) {
    if (/^#{1,6}\s+.*(excluded|confidential|boundar)/i.test(line)) {
      inExcluded = true;
      continue;
    }

    if (inExcluded && /^#{1,6}\s+/.test(line)) {
      break;
    }

    if (inExcluded) {
      const match = /^\s*[-*]\s+(.+)/.exec(line);
      if (match) {
        excluded.push(match[1].replace(/`/g, '').trim());
      }
    }
  }

  return excluded;
}

/**
 * Index all constitutions in a workspace and configured sibling repos.
 */
export async function indexConstitutions(roots: string[]): Promise<ConstitutionEntry[]> {
  const entries: ConstitutionEntry[] = [];

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    const spokeName = path.basename(resolvedRoot);

    // Check for root-level CONSTITUTION.md
    const constPath = path.join(resolvedRoot, 'CONSTITUTION.md');
    try {
      const content = await fs.readFile(constPath, 'utf-8');
      entries.push({
        path: constPath,
        relativePath: 'CONSTITUTION.md',
        spokeName,
        purpose: extractPurpose(content),
        directorySemantics: extractDirectorySemantics(content),
        dependencies: extractDependencies(content),
        excluded: extractExcluded(content),
        entryPoints: extractEntryPoints(content),
      });
    } catch {
      // No constitution at root — skip
    }

    // Check subdirectories for spoke-level constitutions
    try {
      const dirEntries = await fs.readdir(resolvedRoot, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules' &&
          entry.name !== 'dist'
        ) {
          const spokeConstPath = path.join(resolvedRoot, entry.name, 'CONSTITUTION.md');
          try {
            const content = await fs.readFile(spokeConstPath, 'utf-8');
            entries.push({
              path: spokeConstPath,
              relativePath: path.join(entry.name, 'CONSTITUTION.md'),
              spokeName: entry.name,
              purpose: extractPurpose(content),
              directorySemantics: extractDirectorySemantics(content),
              dependencies: extractDependencies(content),
              excluded: extractExcluded(content),
              entryPoints: extractEntryPoints(content),
            });
          } catch {
            // No constitution in this subdirectory
          }
        }
      }
    } catch {
      // Can't read directory
    }
  }

  return entries;
}
