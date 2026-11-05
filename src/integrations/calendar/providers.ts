import { OAuthTransientError, type OAuthProviderKey } from "../oauth/types";
import type { CalendarProviderClient, EventInput, ProviderEvent } from "./types";

/**
 * The real Google Calendar and Microsoft Graph calendar clients (FIG-808). Each takes a `fetch` so a test can put a fake provider
 * server in front of it. Scopes needed: events read and write (and the calendar list to let the person choose one).
 */
type Fetch = typeof fetch;

async function call(fetchImpl: Fetch, url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new OAuthTransientError();
  }
  if (!res.ok && res.status !== 410) throw new OAuthTransientError(`The calendar provider answered ${res.status}.`);
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// ----------------------------- Google Calendar -----------------------------

type GEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
  organizer?: { email?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  updated?: string;
};

function fromGoogle(e: GEvent): ProviderEvent {
  return {
    id: e.id,
    etag: e.etag ?? null,
    title: e.summary ?? "",
    description: e.description ?? null,
    start: new Date(e.start?.dateTime ?? e.start?.date ?? Date.now()),
    end: new Date(e.end?.dateTime ?? e.end?.date ?? Date.now()),
    attendees: (e.attendees ?? []).map((a) => (a.email ?? "").toLowerCase()).filter(Boolean),
    organizerEmail: e.organizer?.email?.toLowerCase() ?? null,
    status: e.status === "cancelled" ? "cancelled" : "confirmed",
    joinUrl: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null,
    updatedAt: new Date(e.updated ?? Date.now()),
  };
}

function googleBody(input: Partial<EventInput>): Record<string, unknown> {
  return {
    ...(input.title !== undefined ? { summary: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.start ? { start: { dateTime: input.start.toISOString() } } : {}),
    ...(input.end ? { end: { dateTime: input.end.toISOString() } } : {}),
    ...(input.attendees ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
  };
}

function googleClient(fetchImpl: Fetch): CalendarProviderClient {
  const base = "https://www.googleapis.com/calendar/v3";
  return {
    async listCalendars(token) {
      const res = await call(fetchImpl, `${base}/users/me/calendarList`, token);
      return ((res.items as { id: string; summary?: string; primary?: boolean }[] | undefined) ?? []).map((c) => ({ id: c.id, name: c.summary ?? c.id, primary: c.primary === true }));
    },
    async listEvents(token, calendarId, { updatedSince, limit }) {
      const url = `${base}/calendars/${encodeURIComponent(calendarId)}/events?showDeleted=true&singleEvents=true&maxResults=${limit}&updatedMin=${encodeURIComponent(updatedSince.toISOString())}`;
      return (((await call(fetchImpl, url, token)).items as GEvent[] | undefined) ?? []).map(fromGoogle);
    },
    async createEvent(token, calendarId, input) {
      const body = {
        ...googleBody(input),
        ...(input.withVideo ? { conferenceData: { createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
      };
      const url = `${base}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all${input.withVideo ? "&conferenceDataVersion=1" : ""}`;
      return fromGoogle((await call(fetchImpl, url, token, { method: "POST", body: JSON.stringify(body) })) as unknown as GEvent);
    },
    async updateEvent(token, calendarId, eventId, patch) {
      const url = `${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
      return fromGoogle((await call(fetchImpl, url, token, { method: "PATCH", body: JSON.stringify(googleBody(patch)) })) as unknown as GEvent);
    },
    async cancelEvent(token, calendarId, eventId) {
      await call(fetchImpl, `${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, token, { method: "DELETE" });
    },
  };
}

// ----------------------------- Microsoft Graph -----------------------------

type MEvent = {
  id: string;
  changeKey?: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { emailAddress?: { address?: string } }[];
  organizer?: { emailAddress?: { address?: string } };
  isCancelled?: boolean;
  onlineMeeting?: { joinUrl?: string };
  lastModifiedDateTime?: string;
};

const utc = (s: string | undefined) => new Date(s && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : (s ?? Date.now()));

function fromGraph(e: MEvent): ProviderEvent {
  return {
    id: e.id,
    etag: e.changeKey ?? null,
    title: e.subject ?? "",
    description: e.bodyPreview ?? null,
    start: utc(e.start?.dateTime),
    end: utc(e.end?.dateTime),
    attendees: (e.attendees ?? []).map((a) => (a.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
    organizerEmail: e.organizer?.emailAddress?.address?.toLowerCase() ?? null,
    status: e.isCancelled ? "cancelled" : "confirmed",
    joinUrl: e.onlineMeeting?.joinUrl ?? null,
    updatedAt: new Date(e.lastModifiedDateTime ?? Date.now()),
  };
}

function graphBody(input: Partial<EventInput>): Record<string, unknown> {
  return {
    ...(input.title !== undefined ? { subject: input.title } : {}),
    ...(input.description !== undefined ? { body: { contentType: "text", content: input.description ?? "" } } : {}),
    ...(input.start ? { start: { dateTime: input.start.toISOString(), timeZone: "UTC" } } : {}),
    ...(input.end ? { end: { dateTime: input.end.toISOString(), timeZone: "UTC" } } : {}),
    ...(input.attendees ? { attendees: input.attendees.map((address) => ({ emailAddress: { address }, type: "required" })) } : {}),
  };
}

function graphClient(fetchImpl: Fetch): CalendarProviderClient {
  const base = "https://graph.microsoft.com/v1.0/me";
  return {
    async listCalendars(token) {
      const res = await call(fetchImpl, `${base}/calendars`, token);
      return ((res.value as { id: string; name?: string; isDefaultCalendar?: boolean }[] | undefined) ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id, primary: c.isDefaultCalendar === true }));
    },
    async listEvents(token, calendarId, { updatedSince, limit }) {
      const filter = encodeURIComponent(`lastModifiedDateTime ge ${updatedSince.toISOString()}`);
      const res = await call(fetchImpl, `${base}/calendars/${encodeURIComponent(calendarId)}/events?$top=${limit}&$filter=${filter}`, token, { headers: { prefer: 'outlook.timezone="UTC"' } });
      return ((res.value as MEvent[] | undefined) ?? []).map(fromGraph);
    },
    async createEvent(token, calendarId, input) {
      const body = { ...graphBody(input), ...(input.withVideo ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}), transactionId: input.requestId };
      return fromGraph((await call(fetchImpl, `${base}/calendars/${encodeURIComponent(calendarId)}/events`, token, { method: "POST", body: JSON.stringify(body), headers: { prefer: 'outlook.timezone="UTC"' } })) as unknown as MEvent);
    },
    async updateEvent(token, _calendarId, eventId, patch) {
      return fromGraph((await call(fetchImpl, `${base}/events/${encodeURIComponent(eventId)}`, token, { method: "PATCH", body: JSON.stringify(graphBody(patch)), headers: { prefer: 'outlook.timezone="UTC"' } })) as unknown as MEvent);
    },
    async cancelEvent(token, _calendarId, eventId) {
      await call(fetchImpl, `${base}/events/${encodeURIComponent(eventId)}/cancel`, token, { method: "POST", body: JSON.stringify({ comment: "Cancelled in Figbloom." }) });
    },
  };
}

export function createCalendarProvider(provider: OAuthProviderKey, fetchImpl: Fetch = fetch): CalendarProviderClient {
  return provider === "GOOGLE" ? googleClient(fetchImpl) : graphClient(fetchImpl);
}
