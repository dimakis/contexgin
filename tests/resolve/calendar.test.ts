import { describe, it, expect } from 'vitest';
import { calendarResolver } from '../../src/resolve/calendar.js';
import { findResolver } from '../../src/resolve/registry.js';

describe('calendarResolver', () => {
  describe('canHandle', () => {
    it('returns true for calendar origin', () => {
      expect(calendarResolver.canHandle({ source: 'calendar' })).toBe(true);
    });

    it('returns false for chat origin', () => {
      expect(calendarResolver.canHandle({ source: 'chat' })).toBe(false);
    });

    it('returns false for telos origin', () => {
      expect(calendarResolver.canHandle({ source: 'telos' })).toBe(false);
    });
  });

  describe('registry integration', () => {
    it('findResolver returns calendarResolver for calendar origin', () => {
      const resolver = findResolver({ source: 'calendar' });
      expect(resolver).toBe(calendarResolver);
    });
  });

  describe('resolve', () => {
    it('returns empty manifest when no metadata provided', async () => {
      const manifest = await calendarResolver.resolve({ source: 'calendar' }, '/workspace', []);
      expect(manifest).toEqual({});
    });

    it('returns empty manifest when eventSummary is missing', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: { startTime: '2026-05-12T10:00:00Z' },
        },
        '/workspace',
        [],
      );
      expect(manifest).toEqual({});
    });

    it('returns taskHint with event summary', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: { eventSummary: '1:1 with Cat' },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Meeting: 1:1 with Cat');
    });

    it('includes formatted start time', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Team standup',
            startTime: '2026-05-12T10:00:00Z',
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('When:');
      // Should contain readable date components
      expect(manifest.taskHint).toContain('May');
      expect(manifest.taskHint).toContain('12');
    });

    it('includes attendees, excluding self', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: '1:1 with Cat',
            attendees: [
              { name: 'Dimitri Saridakis', email: 'dsaridak@redhat.com', self: true },
              { name: 'Cat Chenal', email: 'cchenal@redhat.com' },
            ],
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Cat Chenal (cchenal@redhat.com)');
      expect(manifest.taskHint).not.toContain('Dimitri Saridakis');
    });

    it('handles attendees without names', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Quick sync',
            attendees: [{ email: 'unknown@example.com' }],
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Attendees: unknown@example.com');
    });

    it('includes event description', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Sprint planning',
            description: 'Review backlog and assign stories',
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Description: Review backlog and assign stories');
    });

    it('truncates long descriptions', async () => {
      const longDesc = 'x'.repeat(600);
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Meeting',
            description: longDesc,
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint!.length).toBeLessThan(longDesc.length + 100);
      expect(manifest.taskHint).toContain('...');
    });

    it('builds complete taskHint with all fields', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'AI Gateway F2F',
            startTime: '2026-05-12T14:00:00Z',
            attendees: [
              { name: 'Roland Huss', email: 'rhuss@redhat.com' },
              { name: 'Adel Zaalouk', email: 'azaalouk@redhat.com' },
            ],
            description: 'Deep dive on agent identity architecture',
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Meeting: AI Gateway F2F');
      expect(manifest.taskHint).toContain('When:');
      expect(manifest.taskHint).toContain('Roland Huss');
      expect(manifest.taskHint).toContain('Adel Zaalouk');
      expect(manifest.taskHint).toContain('Description: Deep dive on agent identity architecture');
    });

    it('does not modify sources', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: { eventSummary: 'Meeting' },
        },
        '/workspace',
        [],
      );

      expect(manifest.sources).toBeUndefined();
      expect(manifest.excluded).toBeUndefined();
    });

    it('ignores invalid metadata types gracefully', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Valid meeting',
            startTime: 12345, // wrong type
            attendees: 'not-an-array', // wrong type
            description: true, // wrong type
          },
        },
        '/workspace',
        [],
      );

      // Should still return taskHint from valid eventSummary
      expect(manifest.taskHint).toContain('Meeting: Valid meeting');
      // Invalid fields should be silently ignored
      expect(manifest.taskHint).not.toContain('When:');
      expect(manifest.taskHint).not.toContain('Attendees:');
      expect(manifest.taskHint).not.toContain('Description:');
    });

    it('filters out invalid attendee objects', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Meeting',
            attendees: [
              { name: 'Valid', email: 'valid@example.com' },
              { name: 'No email' }, // missing email
              'not an object', // wrong type
              null, // null
              { email: 123 }, // wrong email type
            ],
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Valid (valid@example.com)');
      expect(manifest.taskHint).not.toContain('No email');
    });

    it('omits attendees line when all are self', async () => {
      const manifest = await calendarResolver.resolve(
        {
          source: 'calendar',
          metadata: {
            eventSummary: 'Focus time',
            attendees: [{ name: 'Me', email: 'me@example.com', self: true }],
          },
        },
        '/workspace',
        [],
      );

      expect(manifest.taskHint).toContain('Meeting: Focus time');
      expect(manifest.taskHint).not.toContain('Attendees:');
    });
  });
});
