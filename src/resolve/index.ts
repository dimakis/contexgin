/**
 * Origin-aware context resolution.
 * Determines what additional context to inject based on how a session was triggered.
 */

export { resolveOrigin, findResolver } from './registry.js';
export { chatResolver } from './chat.js';
export { telosResolver } from './telos.js';
export { calendarResolver } from './calendar.js';
export type { OriginSource, SessionOrigin, ResolvedManifest, OriginResolver } from './types.js';
