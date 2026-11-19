/**
 * The Figbloom Platform API, as CRM calls it to create people's Figbloom accounts (ERP/CRM_COGNITO_CONTRACT.md
 * section 1; the same routes Fleet uses). CRM signs in as its own machine client (crm-service-<env>) with the
 * client-credentials grant. The token is kept in memory until a minute before it expires, and fetched again once if
 * the API answers 401.
 *
 *   PLATFORM_API_URL, PLATFORM_TOKEN_URL, PLATFORM_CLIENT_ID, PLATFORM_CLIENT_SECRET
 */

const SCOPE = "platform/tenants.read platform/tenants.write";
const TIMEOUT_MS = 10_000;
const EXPIRY_MARGIN_MS = 60_000;

/** A refusal or failure from the platform; status 0 means it was never reached. Never carries a secret. */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export interface PlatformConfig {
  apiUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

type Env = Record<string, string | undefined>;

export function platformConfig(env: Env = process.env): PlatformConfig {
  const names = ["PLATFORM_API_URL", "PLATFORM_TOKEN_URL", "PLATFORM_CLIENT_ID", "PLATFORM_CLIENT_SECRET"] as const;
  const missing = names.filter((n) => !env[n]?.trim());
  if (missing.length) throw new Error(`Figbloom sign-in is on but these settings are missing: ${missing.join(", ")}`);
  return {
    apiUrl: (env.PLATFORM_API_URL as string).trim().replace(/\/+$/, ""),
    tokenUrl: (env.PLATFORM_TOKEN_URL as string).trim(),
    clientId: (env.PLATFORM_CLIENT_ID as string).trim(),
    clientSecret: (env.PLATFORM_CLIENT_SECRET as string).trim(),
  };
}

export class PlatformClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: PlatformConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The person's Figbloom account: found by email, or created (with this password when given). An existing account
   * comes back unchanged (`created: false`) and the password is ignored. 400 `invalid_password` when the password
   * fails the pool's rule (the rule is in the message). `emailProven`: a link CRM emailed reached this inbox.
   */
  createUser(body: { email: string; name: string; password?: string; emailProven?: boolean }): Promise<{ user_sub: string; created: boolean }> {
    return this.call("POST", "/users", {
      email: body.email,
      name: body.name,
      ...(body.password ? { password: body.password } : {}),
      ...(body.emailProven ? { email_proven: true } : {}),
    });
  }

  /** The person opened a link CRM emailed them: their email becomes verified, so Figbloom's "Forgot password" reaches them. */
  markEmailVerified(sub: string): Promise<unknown> {
    return this.call("POST", `/users/${encodeURIComponent(sub)}/email-verified`, {});
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal, redirect: "error" });
    } catch {
      throw new PlatformError("Figbloom's platform could not be reached. Please try again.", 0, "unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - EXPIRY_MARGIN_MS) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.send(this.config.tokenUrl, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
    });
    const data = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown } | null;
    if (!res.ok || typeof data?.access_token !== "string") {
      // never the secret, and nothing of Cognito's answer beyond its error code
      throw new PlatformError(
        `Could not get a platform token (${res.status}${typeof data?.error === "string" ? ` ${data.error}` : ""}).`,
        res.status || 0,
        "token_failed",
      );
    }
    const seconds = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
    this.token = { value: data.access_token, expiresAt: this.now() + seconds * 1000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const token = await this.accessToken();
    const res = await this.send(`${this.config.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      this.token = null;
      return this.call<T>(method, path, body, true);
    }
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      throw new PlatformError(data?.error?.message || `The platform answered ${res.status}.`, res.status, data?.error?.code || "platform_error");
    }
    return data as T;
  }
}

let shared: PlatformClient | null = null;

/** The one client per process (it keeps its token). */
export function platformClient(): PlatformClient {
  shared ??= new PlatformClient(platformConfig());
  return shared;
}
