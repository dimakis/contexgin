/**
 * Agent recipe compiler — compile agent definitions into ready-to-serve context.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { compile, discoverSources, estimateTokens } from '../compiler/index.js';
import { isNestedPath } from '../adapter/types.js';
import { resolveOrigin } from '../resolve/index.js';
import { findModuleDir } from '../resolve/module-dir.js';
import type { SessionOrigin } from '../resolve/index.js';
import type { ContextSource } from '../compiler/types.js';
import type {
  AgentDefinition,
  CompiledAgentContext,
  BootContextConfig,
  ContextBlockConfig,
} from './types.js';

/**
 * Expand a leading `~` to the user's home directory.
 * Node.js path APIs do not perform tilde expansion, so we must
 * do it explicitly before using the path in filesystem operations.
 */
function expandTilde(p: string): string {
  if (p === '~') {
    return os.homedir();
  }
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Compile an agent definition into ready-to-serve context.
 * @param def - Agent definition to compile
 * @param workspaceRoot - Workspace root directory
 * @param origin - Optional session origin metadata for context resolution
 * @returns Compiled agent context ready for serving
 */
export async function compileAgent(
  def: AgentDefinition,
  workspaceRoot: string,
  origin?: SessionOrigin,
): Promise<CompiledAgentContext> {
  const root = path.resolve(workspaceRoot);

  // Layer 1: Boot context
  const bootContext = await compileBootContext(def.context.boot, root, origin);

  // Layer 2: Context blocks (supports dynamic resolution via origin)
  const contextBlocks = await compileContextBlocks(def.context.blocks ?? [], root, origin);

  // Layer 3: Operational context
  const operational = def.context.operational
    ? await compileOperationalContext(
        def.context.operational.files,
        root,
        def.context.operational.delivery,
      )
    : undefined;

  // Layer 4: Memory context
  let memory: CompiledAgentContext['memory'] | undefined;
  if (def.context.memory?.enabled) {
    if (def.context.memory.path) {
      memory = await compileMemoryContext(def.context.memory.path, def.context.memory.types);
    } else {
      console.warn('[recipe] Memory enabled but no path specified — skipping memory compilation');
    }
  }

  return {
    identity: def.identity,
    bootContext,
    contextBlocks,
    operational,
    memory,
    governance: def.governance,
    skills: def.skills ?? [],
    provider: def.provider,
  };
}

/**
 * Compile boot context from configuration.
 */
async function compileBootContext(
  config: BootContextConfig | undefined,
  workspaceRoot: string,
  origin?: SessionOrigin,
): Promise<CompiledAgentContext['bootContext']> {
  if (!config) {
    return { content: '', tokens: 0, tokenBudget: 0, sources: [] };
  }

  const budget = config.tokenBudget ?? 8000;

  // Build a filtered sources list by excluding disabled source types.
  // This is more reliable than ID-based exclusion since adapter node IDs
  // don't map 1:1 to config toggles (e.g. constitution produces 'purpose',
  // 'directory-semantics', etc. — not 'constitution').
  const allSources = await discoverSources(workspaceRoot);

  // Resolve additional source globs from config.
  // Track explicitly-requested paths so they bypass the spokes filter —
  // if the user explicitly lists a glob, they want those files regardless
  // of whether spokes are disabled.
  const explicitPaths = new Set<string>();
  if (config.sources && config.sources.length > 0) {
    const globSources = await resolveGlobs(config.sources, workspaceRoot);
    const existingPaths = new Set(allSources.map((s) => s.path));
    for (const gs of globSources) {
      explicitPaths.add(gs.path);
      if (!existingPaths.has(gs.path)) {
        allSources.push(gs);
      }
    }
  }

  const sources = allSources.filter((s) => {
    // Explicitly-requested sources always pass through
    if (explicitPaths.has(s.path)) return true;

    const basename = path.basename(s.relativePath);

    // Spoke-level files — check first since spoke constitutions/CLAUDEs
    // would otherwise match the type-specific filters below
    if (config.spokes === false && isNestedPath(s.relativePath)) {
      // Don't filter profiles or cursor rules — they're not spokes
      if (s.kind !== 'profile' && !s.relativePath.match(/^\.cursor[/\\]/)) {
        return false;
      }
    }

    // CONSTITUTION.md — exclude if explicitly disabled
    if (basename === 'CONSTITUTION.md') {
      return config.constitution !== false;
    }

    // CLAUDE.md — exclude if explicitly disabled
    if (basename === 'CLAUDE.md') {
      return config.claudeMd !== false;
    }

    // Profile files — exclude if explicitly disabled
    if (s.kind === 'profile') {
      return config.profile !== false;
    }

    // Cursor rules — exclude if explicitly disabled
    if (/\.cursor[/\\]rules[/\\]/.test(s.relativePath)) {
      return config.cursorRules !== false;
    }

    return true;
  });

  // Resolve additional context based on session origin
  const resolved = await resolveOrigin(origin, workspaceRoot, sources);

  // Merge resolved sources with defaults (resolved sources take precedence)
  const finalSources = resolved.sources ?? sources;
  const finalExcluded = resolved.excluded;
  const finalTaskHint = resolved.taskHint;

  const result = await compile({
    workspaceRoot,
    tokenBudget: budget,
    sources: finalSources,
    excluded: finalExcluded,
    taskHint: finalTaskHint,
  });

  return {
    content: result.bootPayload,
    tokens: result.bootTokens,
    tokenBudget: budget,
    sources: result.sources.map((s) => s.relativePath),
  };
}

/**
 * Compile context blocks from configuration.
 * Blocks with source: "dynamic" resolve their content from origin metadata
 * (e.g. page origin → module source files).
 */
async function compileContextBlocks(
  blocks: ContextBlockConfig[],
  workspaceRoot: string,
  origin?: SessionOrigin,
): Promise<CompiledAgentContext['contextBlocks']> {
  const compiled = new Map<string, { content: string; tokens: number; source: string }>();

  for (const block of blocks) {
    if (block.source === 'dynamic') {
      // Dynamic blocks resolve content from origin metadata
      const content = await resolveDynamicBlock(block, workspaceRoot, origin);
      if (content) {
        compiled.set(block.id, {
          content,
          tokens: estimateTokens(content),
          source: 'dynamic',
        });
      }
      continue;
    }

    try {
      const fullPath = path.resolve(workspaceRoot, expandTilde(block.source));
      const content = await fs.readFile(fullPath, 'utf-8');

      const tokens = estimateTokens(content);

      compiled.set(block.id, {
        content,
        tokens,
        source: block.source,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[recipe] Failed to load context block ${block.id} from ${block.source}: ${msg}`,
      );
    }
  }

  return compiled;
}

/**
 * Resolve a dynamic context block using origin metadata.
 * For page origins: reads source files from the active module directory.
 */
async function resolveDynamicBlock(
  block: ContextBlockConfig,
  workspaceRoot: string,
  origin?: SessionOrigin,
): Promise<string | undefined> {
  if (!origin || !origin.entityId) return undefined;

  // For page origins, resolve module source files
  if (origin.source === 'page') {
    const moduleName = origin.entityId.replace(/^#?\/?/, '').split('/')[0];
    if (!moduleName) return undefined;

    // Reject path traversal attempts
    if (moduleName.includes('..') || path.isAbsolute(moduleName)) return undefined;

    const moduleDir = await findModuleDir(moduleName, workspaceRoot);
    if (!moduleDir) return undefined;

    // Gather key source files from the module
    const parts: string[] = [`# Module: ${moduleName}`];
    const entries = await collectModuleFiles(moduleDir, workspaceRoot);
    for (const entry of entries) {
      parts.push(`## ${entry.relativePath}\n\n\`\`\`\n${entry.content}\n\`\`\``);
    }

    return parts.length > 1 ? parts.join('\n\n') : undefined;
  }

  return undefined;
}

/**
 * Collect key source files from a module directory (non-recursive, limited depth).
 */
async function collectModuleFiles(
  moduleDir: string,
  workspaceRoot: string,
): Promise<Array<{ relativePath: string; content: string }>> {
  const results: Array<{ relativePath: string; content: string }> = [];
  const maxFiles = 10;

  try {
    const entries = await fs.readdir(moduleDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxFiles) break;

      const fullPath = path.join(moduleDir, entry.name);

      if (entry.isFile() && /\.(js|ts|json|vue|jsx|tsx)$/.test(entry.name)) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          // Skip very large files
          if (content.length > 10_000) continue;
          results.push({
            relativePath: path.relative(workspaceRoot, fullPath),
            content,
          });
        } catch {
          // skip unreadable
        }
      }
    }
  } catch {
    // skip unreadable directory
  }

  return results;
}

/**
 * Compile operational context from file list.
 */
async function compileOperationalContext(
  files: string[],
  workspaceRoot: string,
  delivery: 'sdk' | 'alwaysApply' | 'additionalContext',
): Promise<CompiledAgentContext['operational']> {
  const loaded: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    try {
      const fullPath = path.resolve(workspaceRoot, expandTilde(file));
      const content = await fs.readFile(fullPath, 'utf-8');
      loaded.push({ path: file, content });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[recipe] Failed to load operational file ${file}: ${msg}`);
    }
  }

  return {
    files: loaded,
    delivery,
  };
}

/**
 * Compile memory context from directory.
 *
 * Supports two layouts:
 *   1. Subdirectory: `<memoryPath>/Feedback/*.md`, `<memoryPath>/User/*.md`, etc.
 *   2. Flat prefix:  `<memoryPath>/feedback_*.md`, `<memoryPath>/project_*.md`, etc.
 * Both strategies contribute — duplicates are avoided by tracking seen file paths.
 */
async function compileMemoryContext(
  memoryPath: string,
  types?: Array<'feedback' | 'user' | 'project' | 'reference'>,
): Promise<CompiledAgentContext['memory']> {
  const memory: CompiledAgentContext['memory'] = {
    feedback: [],
    user: [],
    project: [],
    reference: [],
  };

  const resolvedPath = expandTilde(memoryPath);
  const allowedTypes = types ?? ['feedback', 'user', 'project', 'reference'];

  // Pre-read root directory listing for flat-prefix scan (once, not per-type)
  let rootEntries: string[] = [];
  try {
    rootEntries = await fs.readdir(resolvedPath);
  } catch {
    // Root directory doesn't exist — all types will be empty
  }

  for (const type of allowedTypes) {
    const seen = new Set<string>();

    // Strategy 1: Subdirectory (e.g. Feedback/*.md)
    try {
      const typePath = path.join(resolvedPath, capitalize(type));
      const entries = await fs.readdir(typePath);

      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          const filePath = path.join(typePath, entry);
          const content = await fs.readFile(filePath, 'utf-8');
          memory[type].push(content);
          seen.add(filePath);
        }
      }
    } catch {
      // Subdirectory doesn't exist — fall through to flat prefix
    }

    // Strategy 2: Flat prefix (e.g. feedback_*.md in root)
    const prefix = `${type}_`;
    for (const entry of rootEntries) {
      if (entry.startsWith(prefix) && entry.endsWith('.md')) {
        const filePath = path.join(resolvedPath, entry);
        if (!seen.has(filePath)) {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            memory[type].push(content);
          } catch {
            // File unreadable — skip
          }
        }
      }
    }
  }

  return memory;
}

// Resolve file globs relative to a workspace root.
// Supports patterns with * wildcards. Plain paths are resolved directly.
async function resolveGlobs(patterns: string[], workspaceRoot: string): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Reject patterns with path traversal
    if (pattern.includes('..') || path.isAbsolute(pattern)) {
      console.warn(`[recipe] Rejecting glob pattern with traversal: "${pattern}"`);
      continue;
    }

    try {
      const matches = await expandGlob(pattern, workspaceRoot);
      for (const match of matches) {
        const fullPath = path.resolve(workspaceRoot, match);
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);
        sources.push({
          path: fullPath,
          kind: 'reference',
          relativePath: match,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[recipe] Failed to resolve glob "${pattern}": ${msg}`);
    }
  }

  return sources;
}

// Expand a glob pattern into matching file paths relative to root.
// Supports * (single-level wildcard) and ** (recursive descent).
async function expandGlob(pattern: string, root: string): Promise<string[]> {
  const segments = pattern.split('/');
  return expandSegments(segments, 0, root, '');
}

// Maximum recursion depth for ** glob patterns to prevent runaway traversal
const MAX_GLOB_DEPTH = 10;

async function expandSegments(
  segments: string[],
  index: number,
  root: string,
  prefix: string,
  depth: number = 0,
): Promise<string[]> {
  if (index >= segments.length) return [];

  const segment = segments[index];
  const isLast = index === segments.length - 1;
  const currentDir = path.join(root, prefix);

  // ** recursive glob — match zero or more directory levels
  if (segment === '**') {
    if (depth >= MAX_GLOB_DEPTH) return [];

    const results: string[] = [];
    // Try matching remaining segments at this level (zero-depth match)
    const sub = await expandSegments(segments, index + 1, root, prefix, depth);
    results.push(...sub);
    // Recurse into subdirectories
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Continue matching ** at the deeper level
        const deeper = await expandSegments(segments, index, root, relPath, depth + 1);
        results.push(...deeper);
      }
    } catch {
      // directory unreadable
    }
    return results;
  }

  if (segment.includes('*')) {
    // Wildcard segment — list directory and filter
    let entries: string[];
    try {
      entries = await fs.readdir(currentDir);
    } catch {
      return [];
    }

    const regex = new RegExp(
      '^' + segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$',
    );

    const results: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      if (!regex.test(entry)) continue;
      const relPath = prefix ? `${prefix}/${entry}` : entry;

      if (isLast) {
        try {
          const stat = await fs.stat(path.join(root, relPath));
          if (stat.isFile()) results.push(relPath);
        } catch {
          // skip
        }
      } else {
        const sub = await expandSegments(segments, index + 1, root, relPath);
        results.push(...sub);
      }
    }
    return results;
  } else {
    // Literal segment
    const relPath = prefix ? `${prefix}/${segment}` : segment;

    if (isLast) {
      try {
        const stat = await fs.stat(path.join(root, relPath));
        if (stat.isFile()) return [relPath];
      } catch {
        return [];
      }
    }

    return expandSegments(segments, index + 1, root, relPath);
  }
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
