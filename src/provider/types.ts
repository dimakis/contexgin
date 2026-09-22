export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface SessionInfo {
  id: string;
  name?: string;
  createdAt: Date;
  lastActiveAt: Date;
}

/** User input to the agent */
export type AgentInput =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mediaType: string };

/** Unified event stream from any provider */
export type AgentEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_end' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'tool_start'; toolId: string; toolName: string; input: unknown }
  | { type: 'tool_end'; toolId: string; result: unknown; error?: boolean }
  | { type: 'permission_request'; toolName: string; input: unknown; requestId: string }
  | { type: 'message_end'; messageId: string; usage?: TokenUsage }
  | { type: 'error'; message: string };

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
