// ── Agent Definition Types ─────────────────────────────────────
//
// TypeScript representation of the AgentDefinition schema from
// centaur/schemas/agent/agent-definition.yaml. These types are
// used by the loader and the recipe endpoint.

export interface AgentDefinition {
  kind: 'AgentDefinition';
  version: string;
  identity: AgentIdentity;
  provider: AgentProvider;
  context: AgentContext;
  output: AgentOutput;
  governance: AgentGovernance;
  memory: AgentMemory;
}

export interface AgentIdentity {
  name: string;
  description: string;
  mode: 'narrow' | 'dynamic';
}

export interface AgentProvider {
  default: string;
}

export interface AgentContext {
  budget: number;
  sources: {
    hubs: Array<{
      path: string;
      spokes?: string[];
    }>;
  };
  priority?: string[];
  exclude?: string[];
  profile: string | null;
}

export interface AgentOutput {
  conventions: {
    commit_style: string | null;
    response_format: string | null;
  };
  guides: string[];
}

export interface AgentGovernance {
  boundaries: Array<{
    spoke: string;
    access: 'none' | 'read' | 'write';
  }>;
  approval: {
    required_for: string[];
    auto_allow: string[];
  };
}

export interface AgentMemory {
  scope: 'none' | 'read' | 'read-write';
  vault: string | null;
}

// ── Recipe Response ────────────────────────────────────────────

export interface AgentRecipeResponse {
  agent: string;
  provider: AgentProvider;
  boot: {
    context: string;
    tokens: number;
    sources: number;
  };
  recipe: {
    profile: string | null;
    memory: AgentMemory;
    output: AgentOutput;
    governance: AgentGovernance;
  };
}
