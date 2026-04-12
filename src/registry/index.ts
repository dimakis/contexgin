// Registry core
export type {
  Schema,
  Declaration,
  Validator,
  ValidationContext,
  ValidationResult,
  DriftReport,
  DriftSummary,
  DriftDelta,
  WatchConfig,
  NotifyConfig,
  CompatibilityMode,
  DeclarationSeverity,
  WatchMode,
  SchemaVersion,
  CompatibilityResult,
  BreakingChange,
} from './types.js';

// Provider interface
export type { SchemaProvider, SchemaSource } from './provider.js';

// Built-in providers
export { WorkspaceProvider } from './providers/workspace.js';
