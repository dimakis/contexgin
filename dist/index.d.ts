/** A source file that provides context */
interface ContextSource {
  /** Absolute path to the file */
  path: string;
  /** What kind of source this is */
  kind: 'constitution' | 'profile' | 'memory' | 'service' | 'reference';
  /** Relative path within the workspace */
  relativePath: string;
}
/** A section extracted from a source file */
interface ExtractedSection {
  /** Source file this came from */
  source: ContextSource;
  /** Heading path, e.g. ["Architecture", "Hub-and-Spoke Model"] */
  headingPath: string[];
  /** Heading level (1-6) */
  level: number;
  /** Raw markdown content (excluding the heading itself) */
  content: string;
  /** Approximate token count */
  tokenEstimate: number;
}
/** Relevance ranking for a section */
interface RankedSection extends ExtractedSection {
  /** Relevance score (0-1) */
  relevance: number;
  /** Why this was ranked this way */
  reason: string;
}
/** The compiled output */
interface CompiledContext {
  /** System prompt / boot payload */
  bootPayload: string;
  /** Per-turn context blocks (name -> content) */
  contextBlocks: Map<string, string>;
  /** Suggested reading order for the agent */
  navigationHints: string[];
  /** Token count of the boot payload */
  bootTokens: number;
  /** Sources that contributed */
  sources: ContextSource[];
  /** Sections that were trimmed due to budget */
  trimmed: ExtractedSection[];
}
/** Configuration for a compilation */
interface CompileOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  /** Maximum tokens for boot payload */
  tokenBudget: number;
  /** Source files to compile from (auto-discovered if not provided) */
  sources?: ContextSource[];
  /** Sections to always include regardless of relevance */
  required?: string[][];
  /** Sections to never include */
  excluded?: string[][];
  /** Task description for relevance ranking (optional) */
  taskHint?: string;
}

interface HeadingNode {
  level: number;
  title: string;
  content: string;
  children: HeadingNode[];
  line: number;
}
/**
 * Strip YAML frontmatter (between --- delimiters) from markdown.
 */
declare function stripFrontmatter(source: string): string;
/**
 * Parse a markdown file into a tree of heading nodes.
 * Respects heading hierarchy: H2 is child of H1, H3 is child of H2, etc.
 */
declare function parseMarkdown(source: string): HeadingNode[];

/**
 * Extract a section by heading path.
 * Path example: ["Architecture", "Hub-and-Spoke Model"] finds:
 *   ## Architecture
 *   ### Hub-and-Spoke Model
 *   [this content]
 *
 * Returns null if the path doesn't match.
 */
declare function extractSection(
  nodes: HeadingNode[],
  path: string[],
  source: ContextSource,
): ExtractedSection | null;
/**
 * Extract all level-2 sections (equivalent to build_boot_context's get_level_two_sections).
 */
declare function extractAllLevel2(nodes: HeadingNode[], source: ContextSource): ExtractedSection[];
/**
 * Clean extracted content:
 * - Remove "See:" and "Applied in:" cross-references
 * - Collapse consecutive blank lines to single blank line
 * - Trim leading/trailing whitespace
 */
declare function cleanContent(content: string): string;

/**
 * Rank sections by relevance.
 * Base ranking by source kind + section type.
 * If taskHint provided, boost sections whose headings/content match task terms.
 */
declare function rankSections(
  sections: ExtractedSection[],
  options?: {
    taskHint?: string;
  },
): RankedSection[];

/**
 * Estimate token count for text.
 * Use simple heuristic: ~4 chars per token for English text.
 * Good enough for budget enforcement — not billing accuracy.
 */
declare function estimateTokens(text: string): number;
/**
 * Trim sections to fit within a token budget.
 * Drops lowest-relevance sections first.
 * Returns included sections and trimmed sections.
 */
declare function trimToBudget(
  sections: RankedSection[],
  budget: number,
): {
  included: RankedSection[];
  trimmed: RankedSection[];
};

/**
 * Auto-discover context sources in a workspace.
 * Looks for: CONSTITUTION.md, CLAUDE.md, memory/Profile/*.md, SERVICES.md,
 * and any spoke-level CONSTITUTION.md files.
 */
declare function discoverSources(workspaceRoot: string): Promise<ContextSource[]>;
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
declare function compile(options: CompileOptions): Promise<CompiledContext>;

/** A testable claim extracted from a context file */
interface Claim {
  /** Source file containing the claim */
  source: string;
  /** What is being claimed */
  assertion: string;
  /** Type of claim determines validation strategy */
  kind: 'file_exists' | 'directory_exists' | 'entry_point' | 'boundary' | 'structural';
  /** The specific value to validate (path, name, etc.) */
  target: string;
  /** Line number in source file */
  line: number;
}
/** Result of validating a claim */
interface ClaimResult {
  claim: Claim;
  valid: boolean;
  /** What was actually found (if different from claimed) */
  actual?: string;
  /** Human-readable explanation */
  message: string;
}
/** A drift report for a workspace */
interface DriftReport {
  /** When this report was generated */
  timestamp: Date;
  /** Workspace root */
  workspaceRoot: string;
  /** All claims checked */
  results: ClaimResult[];
  /** Only the invalid claims */
  drift: ClaimResult[];
  /** Summary statistics */
  summary: {
    total: number;
    valid: number;
    invalid: number;
    byKind: Record<
      string,
      {
        total: number;
        invalid: number;
      }
    >;
  };
}

/**
 * Extract testable claims from a context file.
 *
 * Patterns detected:
 * - File paths in backticks: `path/to/file` -> file_exists claim
 * - Directory references: `spoke_name/` -> directory_exists claim
 * - Table rows with paths (e.g., entry points tables)
 * - "Entry points" section -> entry_point claims
 */
declare function extractClaims(content: string, sourcePath: string): Claim[];

/**
 * Validate a single claim against the filesystem.
 */
declare function validateClaim(claim: Claim, workspaceRoot: string): Promise<ClaimResult>;
/**
 * Validate all claims and produce a drift report.
 */
declare function validateAll(claims: Claim[], workspaceRoot: string): Promise<DriftReport>;

/** An indexed constitution */
interface ConstitutionEntry {
  /** Absolute path to the constitution file */
  path: string;
  /** Workspace-relative path */
  relativePath: string;
  /** Spoke/repo name derived from path */
  spokeName: string;
  /** Purpose extracted from the constitution */
  purpose: string;
  /** Directory semantics (what belongs where) */
  directorySemantics: Map<string, string>;
  /** Declared dependencies on other spokes */
  dependencies: string[];
  /** Excluded spokes (confidentiality boundaries) */
  excluded: string[];
  /** Entry points */
  entryPoints: string[];
}
/** A directed reading list for a task */
interface ReadingList {
  /** Task that prompted this reading list */
  task: string;
  /** Ordered list of files to read */
  items: ReadingItem[];
}
interface ReadingItem {
  /** File to read */
  path: string;
  /** Why this file is relevant */
  reason: string;
  /** Specific section to focus on (if applicable) */
  section?: string;
  /** Priority (1 = read first) */
  priority: number;
}

/**
 * Extract purpose from a constitution (first paragraph after "## Purpose").
 */
declare function extractPurpose(content: string): string;
/**
 * Extract entry points from a constitution.
 * Looks for backtick-enclosed items in the "Entry Points" section table.
 */
declare function extractEntryPoints(content: string): string[];
/**
 * Index all constitutions in a workspace and configured sibling repos.
 */
declare function indexConstitutions(roots: string[]): Promise<ConstitutionEntry[]>;

/**
 * Generate a directed reading list for a task.
 *
 * 1. Check which constitutions mention relevant terms
 * 2. Order by relevance (constitutional -> dependencies -> reference)
 * 3. Include specific sections where possible
 * 4. Cap at 10 items
 */
declare function generateReadingList(task: string, index: ConstitutionEntry[]): ReadingList;

/**
 * Check if accessing a spoke is allowed based on constitution boundaries.
 * A spoke access is denied if the requesting spoke lists the target in its excluded list.
 */
declare function isAccessAllowed(
  requestingSpoke: ConstitutionEntry,
  targetSpokeName: string,
): boolean;
/**
 * Get all spokes that are accessible from a given spoke.
 */
declare function getAccessibleSpokes(
  from: ConstitutionEntry,
  allSpokes: ConstitutionEntry[],
): ConstitutionEntry[];

/** Definition of a tool available to the agent */
interface ToolDefinition {
  /** Tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** Whether this tool requires permission to execute */
  requiresPermission?: boolean;
  /** Tool source: built-in function or MCP server */
  source: 'builtin' | 'mcp';
}
/** Result of a tool execution */
interface ToolResult {
  /** Tool name that was executed */
  toolName: string;
  /** Result content */
  content: unknown;
  /** Whether the tool execution failed */
  isError?: boolean;
}
/** MCP server connection configuration */
interface McpServerConfig {
  /** Server name */
  name: string;
  /** Transport type */
  transport: 'stdio' | 'sse';
  /** Command to start the server (for stdio) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** URL for SSE transport */
  url?: string;
}

/** Permission decision */
type PermissionDecision = 'allow' | 'deny' | 'ask';
/** A permission rule */
interface PermissionRule {
  /** Tool name pattern (supports glob) */
  tool: string;
  /** Decision for matching tools */
  decision: PermissionDecision;
  /** Optional condition for the rule */
  condition?: Record<string, unknown>;
}
/** Permission policy configuration */
interface PermissionPolicy {
  /** Default decision when no rule matches */
  defaultDecision: PermissionDecision;
  /** Ordered list of rules (first match wins) */
  rules: PermissionRule[];
}
/** Result of evaluating a permission request */
interface PermissionEvaluation {
  /** The decision */
  decision: PermissionDecision;
  /** Which rule matched (if any) */
  matchedRule?: PermissionRule;
  /** Reason for the decision */
  reason: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
interface SessionInfo {
  id: string;
  name?: string;
  createdAt: Date;
  lastActiveAt: Date;
}
/** User input to the agent */
type AgentInput =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      data: string;
      mediaType: string;
    };
/** Unified event stream from any provider */
type AgentEvent =
  | {
      type: 'message_start';
      messageId: string;
    }
  | {
      type: 'text_delta';
      text: string;
    }
  | {
      type: 'text_end';
    }
  | {
      type: 'thinking_delta';
      text: string;
    }
  | {
      type: 'thinking_end';
    }
  | {
      type: 'tool_start';
      toolId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: 'tool_end';
      toolId: string;
      result: unknown;
      error?: boolean;
    }
  | {
      type: 'permission_request';
      toolName: string;
      input: unknown;
      requestId: string;
    }
  | {
      type: 'message_end';
      messageId: string;
      usage?: TokenUsage;
    }
  | {
      type: 'error';
      message: string;
    };
interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/** Options for creating a session */
interface SessionOptions {
  /** Model identifier */
  model: string;
  /** Working directory */
  cwd: string;
  /** Compiled context to inject */
  context: CompiledContext;
  /** Tools available to the agent */
  tools?: ToolDefinition[];
  /** Permission policy */
  permissions?: PermissionPolicy;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}
/** Provider adapter interface */
interface AgentProvider {
  readonly name: string;
  createSession(opts: SessionOptions): Promise<AgentSession>;
  resumeSession(id: string, opts: SessionOptions): Promise<AgentSession>;
  listSessions(): Promise<SessionInfo[]>;
}
/** Active agent session */
interface AgentSession {
  readonly id: string;
  send(input: AgentInput, contextBlocks?: Map<string, string>): AsyncGenerator<AgentEvent>;
  abort(): void;
  getMessages(): Promise<AgentMessage[]>;
}

/**
 * Tool registry — manages available tools for agent sessions.
 * Implementation deferred to provider integration phase.
 */
declare class ToolRegistry {
  private tools;
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  has(name: string): boolean;
  remove(name: string): boolean;
}

/**
 * Evaluate a permission request against a policy.
 * First matching rule wins.
 */
declare function evaluatePermission(
  toolName: string,
  policy: PermissionPolicy,
): PermissionEvaluation;

export {
  type AgentEvent,
  type AgentInput,
  type AgentMessage,
  type AgentProvider,
  type AgentSession,
  type Claim,
  type ClaimResult,
  type CompileOptions,
  type CompiledContext,
  type ConstitutionEntry,
  type ContextSource,
  type DriftReport,
  type ExtractedSection,
  type HeadingNode,
  type McpServerConfig,
  type PermissionDecision,
  type PermissionEvaluation,
  type PermissionPolicy,
  type PermissionRule,
  type RankedSection,
  type ReadingItem,
  type ReadingList,
  type SessionInfo,
  type SessionOptions,
  type TokenUsage,
  type ToolDefinition,
  ToolRegistry,
  type ToolResult,
  cleanContent,
  compile,
  discoverSources,
  estimateTokens,
  evaluatePermission,
  extractAllLevel2,
  extractClaims,
  extractEntryPoints,
  extractPurpose,
  extractSection,
  generateReadingList,
  getAccessibleSpokes,
  indexConstitutions,
  isAccessAllowed,
  parseMarkdown,
  rankSections,
  stripFrontmatter,
  trimToBudget,
  validateAll,
  validateClaim,
};
