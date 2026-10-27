import { copy } from "./copy";

/**
 * Maps whatever went wrong (an `ApiRequestError` from the typed client, a network failure, anything thrown) to what the states kit
 * shows. The one rule that matters: a person is never shown a raw error message, a stack trace or an internal code. Only the API's
 * validation messages (400, 409 and 422 with field errors) are written for people and are passed through; everything else comes from the
 * copy deck. The `reference` (the request id) is shown so support can find the failure in the logs.
 */

export type ErrorKind = "signedOut" | "noAccess" | "notFound" | "validation" | "conflict" | "rateLimited" | "offline" | "server";

export interface Denial {
  yourRole: string | null;
  ownerRoles: string[];
  whoToAsk: string[];
}

export interface DescribedError {
  kind: ErrorKind;
  title: string;
  body: string;
  /** The request id, when the server gave one. */
  reference: string | null;
  denial: Denial | null;
  fieldErrors: { path: string; message: string }[];
  retryable: boolean;
}

interface ApiErrorLike {
  status?: number;
  envelope?: { code?: string; message?: string; requestId?: string; fieldErrors?: { path: string; message: string }[]; denial?: Denial };
  message?: string;
  name?: string;
}

export function describeError(err: unknown): DescribedError {
  const e = (err ?? {}) as ApiErrorLike;
  const status = typeof e.status === "number" ? e.status : null;
  const reference = e.envelope?.requestId || null;
  const base = { reference, denial: null, fieldErrors: [] as { path: string; message: string }[], retryable: false };

  if (status === null) {
    // fetch rejects with a TypeError when the network is down.
    const offline = (typeof navigator !== "undefined" && navigator.onLine === false) || e.name === "TypeError";
    if (offline) return { ...base, kind: "offline", title: copy.error.offline.title, body: copy.error.offline.body, retryable: true };
    return { ...base, kind: "server", title: copy.error.title, body: copy.error.body, retryable: true };
  }
  if (status === 401) return { ...base, kind: "signedOut", title: copy.error.signedOut.title, body: copy.error.signedOut.body };
  if (status === 403) {
    return {
      ...base,
      kind: "noAccess",
      title: copy.error.title,
      body: copy.noAccess.body,
      denial: e.envelope?.denial ?? { yourRole: null, ownerRoles: [], whoToAsk: [] },
    };
  }
  if (status === 404) return { ...base, kind: "notFound", title: copy.error.notFound.title, body: copy.error.notFound.body };
  if (status === 409) return { ...base, kind: "conflict", title: copy.error.conflict.title, body: e.envelope?.message || copy.error.conflict.body };
  if (status === 429) return { ...base, kind: "rateLimited", title: copy.error.rateLimited.title, body: copy.error.rateLimited.body, retryable: true };
  if (status === 400 || status === 422) {
    const fieldErrors = e.envelope?.fieldErrors ?? [];
    return {
      ...base,
      kind: "validation",
      title: "Check what you entered",
      body: e.envelope?.message || "Some of what you entered needs fixing.",
      fieldErrors,
    };
  }
  return { ...base, kind: "server", title: copy.error.title, body: copy.error.body, retryable: true };
}
