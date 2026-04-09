import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdown, stripFrontmatter } from './parser.js';
import { extractAllLevel2, cleanContent } from './extractor.js';
import { rankSections } from './ranker.js';
import { trimToBudget, estimateTokens } from './trimmer.js';
import type { CompileOptions, CompiledContext, ContextSource } from './types.js';

/**
 * Auto-discover context sources in a workspace.
 * Looks for: CONSTITUTION.md, CLAUDE.md, memory/Profile/*.md, SERVICES.md,
 * and any spoke-level CONSTITUTION.md files.
 */
export async function discoverSources(workspaceRoot: string): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  const root = path.resolve(workspaceRoot);

  // Check for root-level files
  const rootFiles: Array<{ file: string; kind: ContextSource['kind'] }> = [
    { file: 'CONSTITUTION.md', kind: 'constitution' },
    { file: 'CLAUDE.md', kind: 'reference' },
    { file: 'SERVICES.md', kind: 'service' },
  ];

  for (const { file, kind } of rootFiles) {
    const fullPath = path.join(root, file);
    if (await fileExists(fullPath)) {
      sources.push({ path: fullPath, kind, relativePath: file });
    }
  }

  // Check for memory/Profile/*.md
  const profileDir = path.join(root, 'memory', 'Profile');
  if (await dirExists(profileDir)) {
    const profileFiles = await fs.readdir(profileDir);
    for (const file of profileFiles) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(profileDir, file);
        const relativePath = path.join('memory', 'Profile', file);
        sources.push({ path: fullPath, kind: 'profile', relativePath });
      }
    }
  }

  // Check for spoke-level CONSTITUTION.md files (one level deep)
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('node_modules') &&
        entry.name !== 'dist'
      ) {
        const spokeConst = path.join(root, entry.name, 'CONSTITUTION.md');
        if (await fileExists(spokeConst)) {
          sources.push({
            path: spokeConst,
            kind: 'constitution',
            relativePath: path.join(entry.name, 'CONSTITUTION.md'),
          });
        }
      }
    }
  } catch {
    // Directory listing failed — skip spoke discovery
  }

  return sources;
}

/**
 * Compile context for a workspace.
 *
 * 1. Discover or use provided source files
 * 2. Parse each source into heading tree
 * 3. Extract configured sections
 * 4. Rank by relevance (optionally task-aware)
 * 5. Trim to token budget
 * 6. Assemble into CompiledContext
 */
export async function compile(options: CompileOptions): Promise<CompiledContext> {
  const { workspaceRoot, tokenBudget, taskHint } = options;

  // Step 1: Discover sources
  const sources = options.sources ?? (await discoverSources(workspaceRoot));

  // Step 2 & 3: Parse and extract sections from each source
  const allSections = [];

  for (const source of sources) {
    try {
      const raw = await fs.readFile(source.path, 'utf-8');
      const content = stripFrontmatter(raw);
      const nodes = parseMarkdown(content);
      const sections = extractAllLevel2(nodes, source);

      // Clean content and account for heading overhead in token estimate
      for (const section of sections) {
        section.content = cleanContent(section.content);
        // Include heading markup + separator overhead (~2 newlines + heading chars)
        const headingOverhead = section.headingPath[section.headingPath.length - 1].length + 10;
        section.tokenEstimate = estimateTokens(section.content) + estimateTokens(' '.repeat(headingOverhead));
      }

      allSections.push(...sections);
    } catch {
      // Skip files that can't be read
    }
  }

  // Step 4: Rank
  const ranked = rankSections(allSections, { taskHint });

  // Filter excluded sections
  const filtered = options.excluded
    ? ranked.filter(
        (s) =>
          !options.excluded!.some(
            (excl) =>
              excl.length <= s.headingPath.length &&
              excl.every((seg, i) => s.headingPath[i] === seg),
          ),
      )
    : ranked;

  // Step 5: Trim to budget
  const { included, trimmed } = trimToBudget(filtered, tokenBudget);

  // Step 6: Assemble
  const bootPayload = included.map((s) => {
    const heading = '#'.repeat(s.level) + ' ' + s.headingPath[s.headingPath.length - 1];
    return heading + '\n\n' + s.content;
  }).join('\n\n');

  const navigationHints = included.map((s) => s.headingPath.join(' > '));

  return {
    bootPayload,
    contextBlocks: new Map(),
    navigationHints,
    bootTokens: estimateTokens(bootPayload),
    sources,
    trimmed,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// Re-exports
export { parseMarkdown, stripFrontmatter } from './parser.js';
export type { HeadingNode } from './parser.js';
export { extractSection, extractAllLevel2, cleanContent } from './extractor.js';
export { rankSections } from './ranker.js';
export { estimateTokens, trimToBudget } from './trimmer.js';
export * from './types.js';
