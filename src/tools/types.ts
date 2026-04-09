/** Definition of a tool available to the agent */
export interface ToolDefinition {
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
export interface ToolResult {
  /** Tool name that was executed */
  toolName: string;
  /** Result content */
  content: unknown;
  /** Whether the tool execution failed */
  isError?: boolean;
}

/** MCP server connection configuration */
export interface McpServerConfig {
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
