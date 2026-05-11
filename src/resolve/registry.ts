/**
 * Origin resolver registry — dispatches to the appropriate resolver.
 */

import type { OriginResolver, SessionOrigin, ResolvedManifest } from './types.js';
import type { ContextSource } from '../compiler/types.js';
import { chatResolver } from './chat.js';
import { telosResolver } from './telos.js';
import { calendarResolver } from './calendar.js';

/** Registered resolvers in priority order */
const RESOLVERS: OriginResolver[] = [
  telosResolver,
  calendarResolver,
  chatResolver,
  // file resolver will be added in a subsequent phase
];

/**
 * Find a resolver for the given origin.
 * Falls back to chatResolver if no specific resolver matches.
 */
export function findResolver(origin: SessionOrigin): OriginResolver {
  const resolver = RESOLVERS.find((r) => r.canHandle(origin));
  return resolver ?? chatResolver;
}

/**
 * Resolve additional context based on session origin.
 * This is the main entry point for origin-aware context resolution.
 */
export async function resolveOrigin(
  origin: SessionOrigin | undefined,
  workspaceRoot: string,
  defaultSources: ContextSource[],
): Promise<ResolvedManifest> {
  // No origin = plain chat session
  if (!origin) {
    return chatResolver.resolve({ source: 'chat' }, workspaceRoot, defaultSources);
  }

  const resolver = findResolver(origin);
  return resolver.resolve(origin, workspaceRoot, defaultSources);
}
