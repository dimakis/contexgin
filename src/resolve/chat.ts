/**
 * Chat origin resolver — default resolver for plain chat sessions.
 * Returns default sources with no modifications.
 */

import type { OriginResolver, SessionOrigin, ResolvedManifest } from './types.js';

export const chatResolver: OriginResolver = {
  source: 'chat',

  canHandle(origin: SessionOrigin): boolean {
    return origin.source === 'chat';
  },

  async resolve(): Promise<ResolvedManifest> {
    // Chat sessions use default sources from agent definition — no augmentation
    return {};
  },
};
