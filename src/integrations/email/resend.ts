/**
 * Resend, the platform's email API (https://resend.com/docs/api-reference/emails/send-email), used for support requests
 * (docs/SUPPORT_BY_EMAIL.md). One small function over `fetch`: no SDK, so nothing to keep up to date and a test can hand in
 * its own `fetch`.
 *
 * The API key is read from `RESEND_API_KEY` at call time and is never logged, returned or put in an error message. A failed
 * call throws a `ResendError` that carries the HTTP status and Resend's error name, never the response body.
 */
export interface ResendMessage {
  /** "Figbloom CRM <support-requests@your-verified-domain>": the domain must be verified in Resend. */
  from: string;
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Resend tags allow only ASCII letters, numbers, underscores and dashes in both name and value. */
  tags?: { name: string; value: string }[];
}

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly resendName: string | null,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function resendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim();
  return key ? key : null;
}

export interface SendOptions {
  /** Resend keeps an Idempotency-Key for 24 hours: the same key never sends the same message twice. */
  idempotencyKey?: string;
  /** For tests. */
  fetchImpl?: typeof fetch;
  apiKey?: string;
}

/** Sends one message. Resolves with Resend's message id, or rejects with a `ResendError`. */
export async function sendWithResend(message: ResendMessage, options: SendOptions = {}): Promise<{ id: string | null }> {
  const apiKey = options.apiKey ?? resendApiKey();
  if (!apiKey) throw new ResendError("RESEND_API_KEY is not set.", null, null);

  const body = {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.tags ? { tags: message.tags } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    throw new ResendError(timedOut ? "Resend did not answer in time." : "Resend could not be reached.", null, null);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let name: string | null = null;
    try {
      const parsed = (await response.json()) as { name?: unknown };
      if (typeof parsed.name === "string") name = parsed.name.slice(0, 80);
    } catch {
      // A non-JSON error body tells us nothing more.
    }
    throw new ResendError(`Resend refused the message (HTTP ${response.status}).`, response.status, name);
  }

  try {
    const parsed = (await response.json()) as { id?: unknown };
    return { id: typeof parsed.id === "string" ? parsed.id : null };
  } catch {
    return { id: null };
  }
}
