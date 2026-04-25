/**
 * Agent recipe loader — parse YAML agent definitions into typed structures.
 */

import * as fs from 'node:fs/promises';
import * as yaml from 'js-yaml';
import type { AgentDefinition } from './types.js';

/**
 * Load an agent definition from a YAML file.
 * @param filePath - Absolute path to the agent YAML file
 * @returns Parsed and validated agent definition
 * @throws Error if file cannot be read or parsed, or if validation fails
 */
export async function loadAgentDefinition(filePath: string): Promise<AgentDefinition> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = yaml.load(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid agent definition: expected object, got ${typeof parsed}`);
  }

  // Basic validation
  const def = parsed as Record<string, unknown>;

  if (!def.identity || typeof def.identity !== 'object') {
    throw new Error('Agent definition missing required field: identity');
  }

  const identity = def.identity as Record<string, unknown>;
  if (typeof identity.name !== 'string' || !identity.name) {
    throw new Error('Agent identity missing required field: name');
  }
  if (typeof identity.description !== 'string' || !identity.description) {
    throw new Error('Agent identity missing required field: description');
  }

  if (!def.provider || typeof def.provider !== 'object') {
    throw new Error('Agent definition missing required field: provider');
  }

  const provider = def.provider as Record<string, unknown>;
  if (typeof provider.provider !== 'string' || !provider.provider) {
    throw new Error('Provider missing required field: provider');
  }
  if (typeof provider.model !== 'string' || !provider.model) {
    throw new Error('Provider missing required field: model');
  }

  // Return the validated definition
  // Full runtime validation would use a schema validator like zod
  return parsed as AgentDefinition;
}

/**
 * Load all agent definitions from a directory.
 * @param dirPath - Directory containing agent YAML files
 * @returns Map of agent name to definition
 */
export async function loadAgentDefinitions(dirPath: string): Promise<Map<string, AgentDefinition>> {
  const definitions = new Map<string, AgentDefinition>();

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        const filePath = `${dirPath}/${entry.name}`;
        try {
          const def = await loadAgentDefinition(filePath);
          definitions.set(def.identity.name, def);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[recipe] Failed to load ${entry.name}: ${msg}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[recipe] Failed to read agent definitions directory: ${msg}`);
  }

  return definitions;
}

/**
 * Validate an agent definition structure.
 * @param def - Agent definition to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateAgentDefinition(def: AgentDefinition): string[] {
  const errors: string[] = [];

  // Identity validation
  if (!def.identity.name) {
    errors.push('identity.name is required');
  }
  if (!def.identity.description) {
    errors.push('identity.description is required');
  }

  // Provider validation
  if (!def.provider.provider) {
    errors.push('provider.provider is required');
  }
  if (!def.provider.model) {
    errors.push('provider.model is required');
  }

  // Context validation
  if (def.context) {
    if (def.context.boot && def.context.boot.tokenBudget) {
      if (def.context.boot.tokenBudget <= 0) {
        errors.push('context.boot.tokenBudget must be positive');
      }
    }

    if (def.context.blocks) {
      for (const block of def.context.blocks) {
        if (!block.id) {
          errors.push('context.blocks[].id is required');
        }
        if (!block.source) {
          errors.push('context.blocks[].source is required');
        }
      }
    }

    if (def.context.operational && !def.context.operational.files) {
      errors.push('context.operational.files is required when operational is defined');
    }

    if (def.context.memory && def.context.memory.enabled && !def.context.memory.path) {
      errors.push('context.memory.path is required when memory is enabled');
    }
  }

  // Skills validation
  if (def.skills) {
    for (const skill of def.skills) {
      if (!skill.id) {
        errors.push('skills[].id is required');
      }
      if (!skill.description) {
        errors.push('skills[].description is required');
      }
    }
  }

  return errors;
}
