// Compiler
export { compile, discoverSources } from './compiler/index.js';
export { parseMarkdown, stripFrontmatter } from './compiler/parser.js';
export type { HeadingNode } from './compiler/parser.js';
export { extractSection, extractAllLevel2, cleanContent } from './compiler/extractor.js';
export { rankSections } from './compiler/ranker.js';
export { estimateTokens, trimToBudget } from './compiler/trimmer.js';
export type {
  ContextSource,
  ExtractedSection,
  RankedSection,
  CompiledContext,
  CompileOptions,
} from './compiler/types.js';

// Integrity
export { extractClaims } from './integrity/claims.js';
export { validateClaim, validateAll } from './integrity/validator.js';
export type { Claim, ClaimResult, DriftReport } from './integrity/types.js';

// Navigation
export {
  indexConstitutions,
  extractPurpose,
  extractEntryPoints,
} from './navigation/constitution-index.js';
export { generateReadingList } from './navigation/reading-list.js';
export { isAccessAllowed, getAccessibleSpokes } from './navigation/boundaries.js';
export type { ConstitutionEntry, ReadingList, ReadingItem } from './navigation/types.js';

// Provider (types only)
export type { SessionOptions, AgentProvider, AgentSession } from './provider/interface.js';
export type {
  TokenUsage,
  SessionInfo,
  AgentInput,
  AgentEvent,
  AgentMessage,
} from './provider/types.js';

// Tools
export { ToolRegistry } from './tools/registry.js';
export type { ToolDefinition, ToolResult, McpServerConfig } from './tools/types.js';

// Graph
export {
  buildGraph,
  parseConstitution,
  parseConstitutionContent,
  resolveReference,
  traverseDependencies,
  isAccessible,
  findSpoke,
  getExternals,
  validateGraph,
  loadIgnorePatterns,
  shouldIgnore,
  VIOLATION_KINDS,
} from './graph/index.js';
export type {
  Hub,
  Spoke,
  Constitution,
  Dependency,
  DependencyKind,
  Boundary,
  EntryPoint as GraphEntryPoint,
  ExternalRef as GraphExternalRef,
  DeclaredNode as GraphDeclaredNode,
  SpokeDeclaration,
  ConfidentialityLevel,
  Violation,
  ViolationKind,
  ViolationSeverity,
  HubGraph,
  ResolvedPath,
  IgnorePatterns,
} from './graph/index.js';

// Permissions
export { evaluatePermission } from './permissions/policy.js';
export type {
  PermissionDecision,
  PermissionRule,
  PermissionPolicy,
  PermissionEvaluation,
} from './permissions/types.js';
