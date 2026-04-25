/**
 * Agent recipe types — declarative agent definitions for multi-client serving.
 */

/** Provider-specific model configuration */
export interface ProviderConfig {
  /** Provider name (anthropic, openai, google, etc.) */
  provider: string;
  /** Model identifier */
  model: string;
  /** Optional temperature override */
  temperature?: number;
  /** Optional max tokens override */
  maxTokens?: number;
  /** Additional provider-specific parameters */
  params?: Record<string, unknown>;
}

/** Boot context configuration */
export interface BootContextConfig {
  /** Include CONSTITUTION.md sections */
  constitution?: boolean | string[];
  /** Include CLAUDE.md sections */
  claudeMd?: boolean | string[];
  /** Include memory/Profile/*.md */
  profile?: boolean | string[];
  /** Include .cursor/rules/*.mdc */
  cursorRules?: boolean | string[];
  /** Token budget for boot context */
  tokenBudget?: number;
}

/** Context block configuration */
export interface ContextBlockConfig {
  /** Block identifier */
  id: string;
  /** Source file or pattern */
  source: string;
  /** Optional section filter */
  sections?: string[];
  /** Optional task hint for relevance boost */
  taskHint?: string;
}

/** Operational context (always-on files, not in boot) */
export interface OperationalContextConfig {
  /** Files to load as operational context */
  files: string[];
  /** Delivery mechanism (sdk, alwaysApply, additionalContext) */
  delivery: 'sdk' | 'alwaysApply' | 'additionalContext';
}

/** Memory context (auto-memory behavioral feedback) */
export interface MemoryContextConfig {
  /** Include auto-memory feedback */
  enabled: boolean;
  /** Memory directory path */
  path?: string;
  /** Memory types to include */
  types?: Array<'feedback' | 'user' | 'project' | 'reference'>;
}

/** Governance boundaries */
export interface GovernanceConfig {
  /** Never do these things */
  forbidden?: string[];
  /** Always do these things */
  required?: string[];
  /** Approval required for these actions */
  approvalRequired?: string[];
}

/** Skill configuration */
export interface SkillConfig {
  /** Skill identifier */
  id: string;
  /** Skill description */
  description: string;
  /** Whether this skill is enabled */
  enabled: boolean;
}

/** Complete agent definition */
export interface AgentDefinition {
  /** Agent identity */
  identity: {
    /** Agent name */
    name: string;
    /** Agent description */
    description: string;
    /** Agent role or purpose */
    role?: string;
  };

  /** Provider configuration */
  provider: ProviderConfig;

  /** Context configuration */
  context: {
    /** Boot context (injected at session start) */
    boot?: BootContextConfig;
    /** Context blocks (per-message dynamic context) */
    blocks?: ContextBlockConfig[];
    /** Operational context (always-on files) */
    operational?: OperationalContextConfig;
    /** Memory context (auto-memory) */
    memory?: MemoryContextConfig;
  };

  /** Governance boundaries */
  governance?: GovernanceConfig;

  /** Available skills */
  skills?: SkillConfig[];

  /** Metadata */
  metadata?: {
    /** Agent version */
    version?: string;
    /** Last updated timestamp */
    updated?: string;
    /** Author or maintainer */
    author?: string;
    /** Tags for categorization */
    tags?: string[];
  };
}

/** Compiled agent context ready for serving */
export interface CompiledAgentContext {
  /** Agent identity */
  identity: AgentDefinition['identity'];

  /** Boot context payload */
  bootContext: {
    /** Compiled markdown content */
    content: string;
    /** Token estimate */
    tokens: number;
    /** Source files included */
    sources: string[];
  };

  /** Context blocks (keyed by block ID) */
  contextBlocks: Map<
    string,
    {
      content: string;
      tokens: number;
      source: string;
    }
  >;

  /** Operational context files */
  operational?: {
    files: Array<{ path: string; content: string }>;
    delivery: OperationalContextConfig['delivery'];
  };

  /** Memory context */
  memory?: {
    feedback: string[];
    user: string[];
    project: string[];
    reference: string[];
  };

  /** Governance rules */
  governance?: GovernanceConfig;

  /** Enabled skills */
  skills: SkillConfig[];

  /** Provider configuration */
  provider: ProviderConfig;
}
