import { describe, it, expect } from 'vitest';
import { resolveOrigin, findResolver, chatResolver } from '../../src/resolve/index.js';
import type { OriginSource } from '../../src/resolve/index.js';

describe('Origin resolution', () => {
  describe('findResolver', () => {
    it('returns chatResolver for chat origin', () => {
      const resolver = findResolver({ source: 'chat' });
      expect(resolver).toBe(chatResolver);
    });

    it('falls back to chatResolver for unknown origin', () => {
      const resolver = findResolver({ source: 'unknown' as OriginSource });
      expect(resolver).toBe(chatResolver);
    });
  });

  describe('resolveOrigin', () => {
    it('returns empty manifest for undefined origin', async () => {
      const manifest = await resolveOrigin(undefined, '/workspace', []);
      expect(manifest).toEqual({});
    });

    it('returns empty manifest for chat origin', async () => {
      const manifest = await resolveOrigin({ source: 'chat' }, '/workspace', []);
      expect(manifest).toEqual({});
    });

    it('does not modify default sources for chat origin', async () => {
      const defaultSources = [
        {
          path: '/workspace/CONSTITUTION.md',
          kind: 'constitution' as const,
          relativePath: 'CONSTITUTION.md',
        },
      ];
      const manifest = await resolveOrigin({ source: 'chat' }, '/workspace', defaultSources);

      expect(manifest.sources).toBeUndefined();
      expect(manifest.excluded).toBeUndefined();
      expect(manifest.taskHint).toBeUndefined();
    });
  });

  describe('chatResolver', () => {
    it('returns true for chat origin in canHandle', () => {
      expect(chatResolver.canHandle({ source: 'chat' })).toBe(true);
    });

    it('returns false for non-chat origin in canHandle', () => {
      expect(chatResolver.canHandle({ source: 'telos', entityId: '42' })).toBe(false);
    });

    it('returns empty manifest in resolve', async () => {
      const manifest = await chatResolver.resolve({ source: 'chat' }, '/workspace', []);
      expect(manifest).toEqual({});
    });
  });
});
