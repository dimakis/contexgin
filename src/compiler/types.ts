/** A source file that provides context */
export interface ContextSource {
  /** Absolute path to the file */
  path: string;
  /** What kind of source this is */
  kind: 'constitution' | 'profile' | 'memory' | 'service' | 'reference';
  /** Relative path within the workspace */
  relativePath: string;
}

/** A section extracted from a source file */
export interface ExtractedSection {
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
export interface RankedSection extends ExtractedSection {
  /** Relevance score (0-1) */
  relevance: number;
  /** Why this was ranked this way */
  reason: string;
}

/** Serializable context node for API responses */
export interface SerializedNode {
  id: string;
  type: string;
  tier: string;
  content: string;
  origin: {
    source: string;
    relativePath: string;
    format: string;
    headingPath?: string[];
  };
  tokenEstimate: number;
}

/** The compiled output */
export interface CompiledContext {
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
  /** Typed context nodes (present when compiled via adapter pipeline) */
  nodes?: SerializedNode[];
  /** Nodes trimmed due to budget (present when compiled via adapter pipeline) */
  trimmedNodes?: SerializedNode[];
}

/** Configuration for a compilation */
export interface CompileOptions {
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
