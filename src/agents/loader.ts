// ── Agent Definition Loader ────────────────────────────────────
//
// Loads agent definitions from YAML files in configured directories.
// Call load() to scan; call again to reload.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition } from './types.js';
import { resolveHome } from './util.js';

export class AgentLoader {
  private definitions = new Map<string, AgentDefinition>();
  private readonly searchPaths: string[];

  constructor(searchPaths: string[]) {
    this.searchPaths = searchPaths;
  }

  /** Load all agent definitions from configured search paths. */
  async load(): Promise<void> {
    this.definitions.clear();

    for (const searchPath of this.searchPaths) {
      await this.loadFromDirectory(searchPath);
    }
  }

  private async loadFromDirectory(dir: string): Promise<void> {
    const resolved = resolveHome(dir);

    let entries: string[];
    try {
      entries = await fs.readdir(resolved);
    } catch {
      // Directory doesn't exist or isn't readable — skip
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

      const filePath = path.join(resolved, entry);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = parseYaml(raw);

        if (parsed == null || typeof parsed !== 'object') continue;

        if (!isAgentDefinition(parsed as Record<string, unknown>)) continue;

        const def = parsed as unknown as AgentDefinition;
        const name = def.identity.name;

        if (this.definitions.has(name)) {
          console.warn(
            `[AgentLoader] duplicate agent name "${name}" — ` +
              `${filePath} overwrites earlier definition`,
          );
        }

        this.definitions.set(name, def);
      } catch {
        // Skip files that can't be parsed
      }
    }
  }

  /** Get an agent definition by name. */
  get(name: string): AgentDefinition | undefined {
    return this.definitions.get(name);
  }

  /** List all loaded agent names. */
  list(): string[] {
    return [...this.definitions.keys()];
  }

  /** Get all loaded definitions. */
  all(): AgentDefinition[] {
    return [...this.definitions.values()];
  }
}

// ── Validation ─────────────────────────────────────────────────

const VALID_MODES = new Set(['narrow', 'dynamic']);
const VALID_MEMORY_SCOPES = new Set(['none', 'read', 'read-write']);

function isAgentDefinition(data: Record<string, unknown>): boolean {
  if (data.kind !== 'AgentDefinition') return false;
  if (typeof data.version !== 'string') return false;

  const identity = data.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity.name !== 'string') return false;
  if (typeof identity.description !== 'string') return false;
  if (!VALID_MODES.has(identity.mode as string)) return false;

  const provider = data.provider as Record<string, unknown> | undefined;
  if (!provider || typeof provider.default !== 'string') return false;

  const context = data.context as Record<string, unknown> | undefined;
  if (!context || typeof context.budget !== 'number' || context.budget < 1) return false;

  const sources = context.sources as Record<string, unknown> | undefined;
  if (!sources || !Array.isArray(sources.hubs)) return false;

  const memory = data.memory as Record<string, unknown> | undefined;
  if (!memory || !VALID_MEMORY_SCOPES.has(memory.scope as string)) return false;

  return true;
}
