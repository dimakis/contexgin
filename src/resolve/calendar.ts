/**
 * Calendar origin resolver — injects meeting context when a session is triggered
 * from a calendar event.
 *
 * The harness (Mitzo, hooks) fetches calendar data and passes event metadata
 * via origin.metadata. This resolver formats it into a structured taskHint
 * for the compiler. Heavy enrichment (Jira, email, docs) stays in the harness.
 */

import type { OriginResolver, SessionOrigin, ResolvedManifest } from './types.js';

/** Attendee metadata passed by the harness */
interface CalendarAttendee {
  name?: string;
  email: string;
  self?: boolean;
}

/** Calendar event metadata passed via origin.metadata */
interface CalendarMetadata {
  eventSummary?: string;
  attendees?: CalendarAttendee[];
  startTime?: string;
  description?: string;
}

/**
 * Extract calendar metadata from origin, validating types.
 */
function extractMetadata(origin: SessionOrigin): CalendarMetadata {
  const meta = origin.metadata ?? {};

  return {
    eventSummary: typeof meta.eventSummary === 'string' ? meta.eventSummary : undefined,
    startTime: typeof meta.startTime === 'string' ? meta.startTime : undefined,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    attendees: Array.isArray(meta.attendees) ? validateAttendees(meta.attendees) : undefined,
  };
}

/**
 * Validate and normalize attendee array from untyped metadata.
 */
function validateAttendees(raw: unknown[]): CalendarAttendee[] {
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .filter((a) => typeof a.email === 'string')
    .map((a) => ({
      email: a.email as string,
      name: typeof a.name === 'string' ? a.name : undefined,
      self: typeof a.self === 'boolean' ? a.self : undefined,
    }));
}

/**
 * Format a start time for display.
 * Handles ISO datetime strings; returns the raw string if parsing fails.
 */
function formatTime(startTime: string): string {
  try {
    const date = new Date(startTime);
    if (isNaN(date.getTime())) return startTime;
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return startTime;
  }
}

/**
 * Format attendees as a concise list, excluding self.
 */
function formatAttendees(attendees: CalendarAttendee[]): string {
  const others = attendees.filter((a) => !a.self);
  if (others.length === 0) return '';

  return others.map((a) => (a.name ? `${a.name} (${a.email})` : a.email)).join(', ');
}

/**
 * Build a taskHint from calendar metadata.
 */
function buildTaskHint(meta: CalendarMetadata): string | undefined {
  // Need at least an event summary to produce useful context
  if (!meta.eventSummary) return undefined;

  const parts: string[] = [];
  parts.push(`Meeting: ${meta.eventSummary}`);

  if (meta.startTime) {
    parts.push(`When: ${formatTime(meta.startTime)}`);
  }

  if (meta.attendees && meta.attendees.length > 0) {
    const formatted = formatAttendees(meta.attendees);
    if (formatted) {
      parts.push(`Attendees: ${formatted}`);
    }
  }

  if (meta.description) {
    // Truncate long descriptions
    const desc =
      meta.description.length > 500 ? meta.description.slice(0, 497) + '...' : meta.description;
    parts.push(`Description: ${desc}`);
  }

  return parts.join('\n');
}

export const calendarResolver: OriginResolver = {
  source: 'calendar',

  canHandle(origin: SessionOrigin): boolean {
    return origin.source === 'calendar';
  },

  async resolve(origin: SessionOrigin): Promise<ResolvedManifest> {
    const meta = extractMetadata(origin);
    const taskHint = buildTaskHint(meta);

    if (!taskHint) {
      return {};
    }

    return { taskHint };
  },
};
