/**
 * Agent recipe compiler — compile agent definitions into ready-to-serve context.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { compile, discoverSources, estimateTokens } from '../compiler/index.js';
import { isNestedPath } from '../adapter/types.js';
import { resolveOrigin } from '../resolve/index.js';
import type { SessionOrigin } from '../resolve/index.js';
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

  // Layer 2: Context blocks
  const contextBlocks = await compileContextBlocks(def.context.blocks ?? [], root);

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
    return { content: '', tokens: 0, sources: [] };
  }

  const budget = config.tokenBudget ?? 8000;

  // Build a filtered sources list by excluding disabled source types.
  // This is more reliable than ID-based exclusion since adapter node IDs
  // don't map 1:1 to config toggles (e.g. constitution produces 'purpose',
  // 'directory-semantics', etc. — not 'constitution').
  const allSources = await discoverSources(workspaceRoot);
  const sources = allSources.filter((s) => {
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
    sources: result.sources.map((s) => s.relativePath),
  };
}

/**
 * Compile context blocks from configuration.
 */
async function compileContextBlocks(
  blocks: ContextBlockConfig[],
  workspaceRoot: string,
): Promise<CompiledAgentContext['contextBlocks']> {
  const compiled = new Map<string, { content: string; tokens: number; source: string }>();

  for (const block of blocks) {
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

/**
 * Capitalize first letter of a string.
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
