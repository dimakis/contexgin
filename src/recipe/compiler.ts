/**
 * Agent recipe compiler — compile agent definitions into ready-to-serve context.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { compileWithAdapters, discoverSources, estimateTokens } from '../compiler/index.js';
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
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Compile an agent definition into ready-to-serve context.
 * @param def - Agent definition to compile
 * @param workspaceRoot - Workspace root directory
 * @returns Compiled agent context ready for serving
 */
export async function compileAgent(
  def: AgentDefinition,
  workspaceRoot: string,
): Promise<CompiledAgentContext> {
  const root = path.resolve(workspaceRoot);

  // Layer 1: Boot context
  const bootContext = await compileBootContext(def.context.boot, root);

  // Layer 2: Context blocks
  const contextBlocks = await compileContextBlocks(def.context.blocks ?? [], root);

  // Layer 3: Operational context
  const operational = def.context.operational
    ? await compileOperationalContext(def.context.operational.files, root, def.context.operational.delivery)
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
    if (config.constitution === false && basename === 'CONSTITUTION.md') return false;
    if (config.claudeMd === false && basename === 'CLAUDE.md') return false;
    if (config.profile === false && s.kind === 'profile') return false;
    if (config.cursorRules === false && s.relativePath.includes('.cursor/rules/')) return false;
    return true;
  });

  const result = await compileWithAdapters({
    workspaceRoot,
    tokenBudget: budget,
    sources,
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
      console.warn(`[recipe] Failed to load context block ${block.id} from ${block.source}: ${msg}`);
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

  for (const type of allowedTypes) {
    try {
      const typePath = path.join(resolvedPath, capitalize(type));
      const entries = await fs.readdir(typePath);

      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          const filePath = path.join(typePath, entry);
          const content = await fs.readFile(filePath, 'utf-8');
          memory[type].push(content);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read — skip
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
