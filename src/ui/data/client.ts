import { createClient, type ApiClient } from "@/api-client";
import { connectivity, type Connectivity } from "./connectivity";
import { currentDataSource, type DataSource } from "./source";

/**
 * The one place the screens' network calls are made from (F1.06). Every screen uses the typed client built here, through the hooks in
 * `hooks.tsx`; nothing else in `src/ui` or `src/app` may call `fetch` (a lint rule and `tests/noDirectFetch.test.ts` enforce it).
 *
 * This is also where the cross-cutting behaviour is attached: request timing feeds the connectivity service (the slow-connection bar),
 * a 401 anywhere tells the shell the session has ended, and the data source decides between the real API and the mock server.
 */

export const SIGNED_OUT_EVENT = "figbloom:signed-out";

export interface AppClientOptions {
  source?: DataSource;
  /** Test seam; defaults to the browser's `fetch`. */
  fetchImpl?: typeof fetch;
  service?: Connectivity;
  onSignedOut?: () => void;
}

export function createAppClient(options: AppClientOptions = {}): ApiClient {
  const source = options.source ?? currentDataSource();
  const service = options.service ?? connectivity;
  const base = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const timedFetch: typeof fetch = async (input, init) => {
    const started = performance.now();
    try {
      const response = await base(input, init);
      service.reportRequest(performance.now() - started);
      return response;
    } catch (error) {
      service.reportRequest(performance.now() - started);
      throw error;
    }
  };

  return createClient({
    baseUrl: source.baseUrl,
    fetch: timedFetch,
    headers: (): Record<string, string> => (source.mockRole ? { "x-mock-role": source.mockRole } : {}),
    onError: (error) => {
      if (error.status === 401) {
        options.onSignedOut?.();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT));
      }
    },
  });
}

let shared: ApiClient | null = null;
/** The browser's shared client. */
export function getApiClient(): ApiClient {
  shared ??= createAppClient();
  return shared;
}

/**
 * The development-only sign-in (`POST /api/dev-session`, FIG-605, FIG-1196). It is not part of the API contract (it exists only when dev accounts are
 * allowed, and answers 404 everywhere else), so it is not in the typed client; it lives here with the other network access. Used by the dev sign-in chips.
 */
export async function signInAsDevAccount(email: string): Promise<{ ok: true; landing: string } | { ok: false; message: string }> {
  const response = await fetch("/api/dev-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: body.error ?? "Sign-in failed." };
  }
  const body = (await response.json().catch(() => ({}))) as { landing?: string };
  return { ok: true, landing: body.landing ?? "/o/figbloom" };
}

/** A fresh idempotency key for one create: the same key on a retry means "answer that request again, do not repeat it" (B0.06). */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
