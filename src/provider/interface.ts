import type { CompiledContext } from '../compiler/types.js';
import type { ToolDefinition } from '../tools/types.js';
import type { PermissionPolicy } from '../permissions/types.js';
import type { AgentInput, AgentEvent, AgentMessage, SessionInfo } from './types.js';

/** Options for creating a session */
export interface SessionOptions {
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
export interface AgentProvider {
  readonly name: string;
  createSession(opts: SessionOptions): Promise<AgentSession>;
  resumeSession(id: string, opts: SessionOptions): Promise<AgentSession>;
  listSessions(): Promise<SessionInfo[]>;
}

/** Active agent session */
export interface AgentSession {
  readonly id: string;
  send(input: AgentInput, contextBlocks?: Map<string, string>): AsyncGenerator<AgentEvent>;
  abort(): void;
  getMessages(): Promise<AgentMessage[]>;
}
