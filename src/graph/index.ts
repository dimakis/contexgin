// Graph module — structural graph for workspace topology

// Builder
export { buildGraph } from './builder.js';

// Parser
export { parseConstitution, parseConstitutionContent } from './parser.js';

// Queries
export {
  resolveReference,
  traverseDependencies,
  isAccessible,
  findSpoke,
  getExternals,
} from './query.js';

// Validation
export { validateGraph } from './validate.js';

// Ignore
export { loadIgnorePatterns, shouldIgnore } from './ignore.js';
export type { IgnorePatterns } from './ignore.js';

// Utilities
export { pathExists } from './utils.js';

// Types
export type {
  Hub,
  Spoke,
  Constitution,
  Dependency,
  DependencyKind,
  Boundary,
  EntryPoint,
  ExternalRef,
  DeclaredNode,
  SpokeDeclaration,
  ConfidentialityLevel,
  Violation,
  ViolationKind,
  ViolationSeverity,
  HubGraph,
  ResolvedPath,
} from './types.js';

export { VIOLATION_KINDS } from './types.js';
