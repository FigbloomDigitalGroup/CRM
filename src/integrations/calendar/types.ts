import type { OAuthProviderKey } from "../oauth/types";

/**
 * The calendar seam (FIG-808): events and meeting links through a connected Google or Microsoft calendar. Services use only
 * this interface, so tests inject a fake. The real clients are in `./providers.ts`. No video engine, recording or transcription:
 * the join link is whatever Google Meet or Teams returns.
 */
export interface ProviderCalendar {
  id: string;
  name: string;
  primary: boolean;
}

export interface ProviderEvent {
  id: string;
  etag: string | null;
  title: string;
  description: string | null;
  start: Date;
  end: Date;
  attendees: string[];
  organizerEmail: string | null;
  status: "confirmed" | "cancelled";
  joinUrl: string | null;
  updatedAt: Date;
}

export interface EventInput {
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
  attendees: string[];
  /** Ask the provider for a Meet or Teams link. */
  withVideo?: boolean;
  /** A key the provider can use to treat a repeated create as the same event. */
  requestId: string;
}

export interface CalendarProviderClient {
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>;
  /** Events changed since a moment (cancelled ones included), for the incremental sync. */
  listEvents(accessToken: string, calendarId: string, options: { updatedSince: Date; limit: number }): Promise<ProviderEvent[]>;
  createEvent(accessToken: string, calendarId: string, input: EventInput): Promise<ProviderEvent>;
  updateEvent(accessToken: string, calendarId: string, eventId: string, patch: Partial<Pick<EventInput, "title" | "description" | "start" | "end" | "attendees">>): Promise<ProviderEvent>;
  /** Cancels the event and tells the attendees. */
  cancelEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}

let factory: ((provider: OAuthProviderKey) => CalendarProviderClient) | null = null;

/** Tests replace the calendar client; pass null to restore the real one. */
export function setCalendarProviderFactory(next: ((provider: OAuthProviderKey) => CalendarProviderClient) | null): void {
  factory = next;
}

export async function getCalendarProvider(provider: OAuthProviderKey): Promise<CalendarProviderClient> {
  if (factory) return factory(provider);
  const { createCalendarProvider } = await import("./providers");
  return createCalendarProvider(provider);
}
