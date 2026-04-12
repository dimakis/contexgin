import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SchemaProvider, SchemaSource } from '../provider.js';
import type { Schema, Declaration, Validator, ValidationResult } from '../types.js';
import type { HubGraph, Violation, ViolationSeverity } from '../../graph/types.js';
import { buildGraph } from '../../graph/builder.js';
import { validateGraph } from '../../graph/validate.js';

// ── Workspace Provider ──────────────────────────────────────────
//
// Wraps the existing hub-and-spoke graph module as a SchemaProvider.
// Discovery finds CONSTITUTION.md files, extraction builds the graph
// and translates violations into declarations, validation delegates
// to buildGraph() + validateGraph().

/**
 * SchemaProvider for hub-and-spoke workspace topology.
 *
 * This provider wraps the existing graph module (builder, parser,
 * validator) behind the SchemaProvider interface. It does NOT replace
 * the graph module — it delegates to it.
 *
 * The workspace provider is intentionally the first and hardest provider.
 * If the provider interface can handle hub-and-spoke complexity, it can
 * handle anything simpler.
 */
export class WorkspaceProvider implements SchemaProvider {
  readonly id = 'workspace';
  readonly name = 'Workspace Topology';

  /** Cached graph from last extract() call */
  private cachedGraph: HubGraph | null = null;
  private cachedRoots: string[] = [];

  async discover(roots: string[]): Promise<SchemaSource[]> {
    const sources: SchemaSource[] = [];

    for (const root of roots) {
      const resolved = path.resolve(root);
      const constPath = path.join(resolved, 'CONSTITUTION.md');

      try {
        await fs.access(constPath);
        sources.push({
          id: `workspace:${path.basename(resolved)}`,
          path: constPath,
          type: 'constitution',
          root: resolved,
        });
      } catch {
        // No CONSTITUTION.md at this root — skip
      }
    }

    return sources;
  }

  async extract(source: SchemaSource): Promise<Schema> {
    // Build graph for this source's root (uses cache if roots match)
    const graph = await this.getGraph([source.root]);
    const hub = graph.hubs.find((h) => h.path === source.root);

    const declarations: Declaration[] = [];

    if (hub) {
      // Hub root tree declarations
      for (const node of hub.constitution.tree) {
        declarations.push({
          kind: node.type === 'directory' ? 'directory_exists' : 'file_exists',
          target: path.join(source.root, node.path),
          severity: 'error',
          description: node.description || `Declared ${node.type}: ${node.path}`,
          metadata: { relativePath: node.path, sourceNode: hub.name },
        });
      }

      // Spoke declarations
      for (const decl of hub.constitution.spokeDeclarations) {
        declarations.push({
          kind: 'spoke_declared',
          target: path.join(source.root, decl.name),
          severity: 'error',
          description: decl.purpose || `Spoke: ${decl.name}`,
          metadata: {
            spokeName: decl.name,
            confidentiality: decl.confidentiality,
            audience: decl.audience,
            governance: decl.governance,
          },
        });
      }

      // Spoke tree declarations
      for (const spoke of hub.spokes) {
        if (!spoke.constitution) continue;
        for (const node of spoke.constitution.tree) {
          declarations.push({
            kind: node.type === 'directory' ? 'directory_exists' : 'file_exists',
            target: path.join(spoke.path, node.path),
            severity: 'warning',
            description: node.description || `${spoke.name}/${node.path}`,
            metadata: { relativePath: node.path, sourceNode: `${hub.name}/${spoke.name}` },
          });
        }
      }

      // Entry points
      for (const ep of hub.constitution.entryPoints) {
        declarations.push({
          kind: 'entry_point',
          target: ep.command,
          severity: 'warning',
          description: ep.description,
          metadata: { resolveRoot: source.root, name: ep.name },
        });
      }
      for (const spoke of hub.spokes) {
        if (!spoke.constitution) continue;
        for (const ep of spoke.constitution.entryPoints) {
          declarations.push({
            kind: 'entry_point',
            target: ep.command,
            severity: 'warning',
            description: ep.description,
            metadata: { resolveRoot: spoke.path, name: ep.name },
          });
        }
      }

      // External references
      for (const ext of hub.externals) {
        declarations.push({
          kind: 'external_reference',
          target: ext.path,
          severity: 'warning',
          description: ext.description || `External: ${ext.path}`,
        });
      }
    }

    const hubName = hub ? hub.name : path.basename(source.root);

    return {
      id: source.id,
      name: `Workspace: ${hubName}`,
      version: '1.0.0',
      compatibility: 'full',
      provider: this.id,
      declarations,
      watchConfig: {
        mode: 'continuous',
        triggers: ['**/CONSTITUTION.md'],
      },
    };
  }

  createValidators(): Validator[] {
    return [
      fileExistsValidator,
      directoryExistsValidator,
      spokeDeclaredValidator,
      entryPointValidator,
      externalReferenceValidator,
    ];
  }

  /**
   * Run full graph build + validate and return results as a DriftReport-compatible
   * set of ValidationResults. This is an alternative path that produces the same
   * violations as the existing graph module, translated into registry types.
   */
  async validateViaGraph(roots: string[]): Promise<ValidationResult[]> {
    const graph = await this.getGraph(roots);
    const violations = await validateGraph(graph);

    // Also include build-time violations from the graph
    const allViolations = [...graph.violations, ...violations];

    return allViolations.map((v) => violationToResult(v));
  }

  /** Build or return cached graph */
  private async getGraph(roots: string[]): Promise<HubGraph> {
    const rootsKey = roots
      .map((r) => path.resolve(r))
      .sort()
      .join(':');
    const cachedKey = [...this.cachedRoots].sort().join(':');

    if (this.cachedGraph && rootsKey === cachedKey) {
      return this.cachedGraph;
    }

    this.cachedGraph = await buildGraph(roots);
    this.cachedRoots = roots.map((r) => path.resolve(r));
    return this.cachedGraph;
  }

  /** Clear cached graph (e.g., after filesystem changes) */
  clearCache(): void {
    this.cachedGraph = null;
    this.cachedRoots = [];
  }
}

// ── Validators ──────────────────────────────────────────────────

const fileExistsValidator: Validator = {
  kind: 'file_exists',
  async validate(declaration, context): Promise<ValidationResult> {
    const targetPath = path.isAbsolute(declaration.target)
      ? declaration.target
      : path.join(context.workspaceRoot, declaration.target);

    try {
      const stat = await fs.stat(targetPath);
      if (stat.isFile()) {
        return { declaration, valid: true, message: `File exists: ${declaration.target}` };
      }
      return {
        declaration,
        valid: false,
        message: `${declaration.target} exists but is not a file`,
        actual: 'directory',
        remediation: `Check if this should be a directory_exists declaration instead`,
      };
    } catch {
      return {
        declaration,
        valid: false,
        message: `Declared file does not exist: ${declaration.target}`,
        remediation: `Create the file or remove it from the constitution`,
      };
    }
  },
};

const directoryExistsValidator: Validator = {
  kind: 'directory_exists',
  async validate(declaration, context): Promise<ValidationResult> {
    const targetPath = path.isAbsolute(declaration.target)
      ? declaration.target
      : path.join(context.workspaceRoot, declaration.target);

    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        return { declaration, valid: true, message: `Directory exists: ${declaration.target}` };
      }
      return {
        declaration,
        valid: false,
        message: `${declaration.target} exists but is not a directory`,
        actual: 'file',
        remediation: `Check if this should be a file_exists declaration instead`,
      };
    } catch {
      return {
        declaration,
        valid: false,
        message: `Declared directory does not exist: ${declaration.target}`,
        remediation: `Create the directory or remove it from the constitution`,
      };
    }
  },
};

const spokeDeclaredValidator: Validator = {
  kind: 'spoke_declared',
  async validate(declaration): Promise<ValidationResult> {
    // Check that the spoke directory exists
    try {
      const stat = await fs.stat(declaration.target);
      if (stat.isDirectory()) {
        return {
          declaration,
          valid: true,
          message: `Spoke directory exists: ${declaration.target}`,
        };
      }
      return {
        declaration,
        valid: false,
        message: `Spoke path exists but is not a directory: ${declaration.target}`,
        remediation: `Create spoke directory or remove from spoke charters`,
      };
    } catch {
      const spokeName =
        (declaration.metadata?.spokeName as string) || path.basename(declaration.target);
      return {
        declaration,
        valid: false,
        message: `Declared spoke ${spokeName}/ does not exist`,
        remediation: `Create directory ${spokeName}/ or remove it from spoke charters`,
      };
    }
  },
};

const entryPointValidator: Validator = {
  kind: 'entry_point',
  async validate(declaration): Promise<ValidationResult> {
    const command = declaration.target;
    const baseCmd = command.split(/\s+/)[0];

    // Skip HTTP endpoints, function exports, system commands
    if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/i.test(command)) {
      return {
        declaration,
        valid: true,
        message: `HTTP endpoint (not filesystem-validated): ${command}`,
      };
    }
    if (baseCmd.endsWith(')')) {
      return {
        declaration,
        valid: true,
        message: `Function export (not filesystem-validated): ${command}`,
      };
    }
    if (!baseCmd.startsWith('./') && !baseCmd.startsWith('../') && !baseCmd.includes('.')) {
      return {
        declaration,
        valid: true,
        message: `System command (not filesystem-validated): ${command}`,
      };
    }

    const resolveRoot = (declaration.metadata?.resolveRoot as string) || '.';
    const cmdPath = path.join(resolveRoot, baseCmd);

    try {
      await fs.access(cmdPath);
      return { declaration, valid: true, message: `Entry point exists: ${command}` };
    } catch {
      return {
        declaration,
        valid: false,
        message: `Entry point ${command} — base file ${baseCmd} not found`,
        remediation: `Update entry point or create ${baseCmd}`,
      };
    }
  },
};

const externalReferenceValidator: Validator = {
  kind: 'external_reference',
  async validate(declaration): Promise<ValidationResult> {
    const refPath = declaration.target.startsWith('~')
      ? path.join(os.homedir(), declaration.target.slice(1))
      : path.resolve(declaration.target);

    try {
      await fs.access(refPath);
      return {
        declaration,
        valid: true,
        message: `External reference exists: ${declaration.target}`,
      };
    } catch {
      return {
        declaration,
        valid: false,
        message: `External reference ${declaration.target} does not exist`,
        remediation: `Update or remove the external reference`,
      };
    }
  },
};

// ── Helpers ─────────────────────────────────────────────────────

const SEVERITY_MAP: Record<ViolationSeverity, 'error' | 'warning' | 'info'> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

/** Convert a graph Violation to a registry ValidationResult */
function violationToResult(violation: Violation): ValidationResult {
  return {
    declaration: {
      kind: violation.kind,
      target: violation.declared,
      severity: SEVERITY_MAP[violation.severity],
      description: violation.message,
    },
    valid: false,
    message: violation.message,
    remediation: violation.suggestion,
    actual: violation.actual,
  };
}
