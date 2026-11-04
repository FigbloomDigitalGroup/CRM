import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { createOAuthProvider, setOAuthProviderFactory } from "../src/integrations/oauth/providers";
import { OAuthInvalidGrantError, SCOPES, type OAuthProviderClient, type TokenSet } from "../src/integrations/oauth/types";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { isSecretBoxConfigured, openSecret, sealSecret, SecretBoxError } from "../src/lib/secretBox";
import {
  ConnectionUnavailableError,
  completeConnection,
  disconnectConnection,
  getAccessToken,
  getUsableConnection,
  listConnections,
  listOrganizationConnections,
  organizationSlugForState,
  startConnection,
  updateConnectionSettings,
} from "../src/services/oauthConnectionService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

// Fake values only: nothing here is a real key, token or client id.
const FAKE_KEY = randomBytes(32).toString("base64");
const ACCESS_1 = "fake-access-token-one";
const REFRESH_1 = "fake-refresh-token-one";
const ACCESS_2 = "fake-access-token-two";

interface FakeProvider extends OAuthProviderClient {
  calls: { exchange: number; refresh: number; revoked: string[] };
  nextRefresh: "ok" | "invalid_grant" | "transient";
  expiresIn: number;
  verifiers: string[];
}

function makeFake(): FakeProvider {
  const fake: FakeProvider = {
    key: "GOOGLE",
    calls: { exchange: 0, refresh: 0, revoked: [] },
    nextRefresh: "ok",
    expiresIn: 3600,
    verifiers: [],
    buildAuthorizationUrl: (r) => `https://fake-provider.test/auth?state=${r.state}&challenge=${r.codeChallenge}&scope=${encodeURIComponent(r.scopes.join(" "))}`,
    async exchangeCode(input): Promise<TokenSet> {
      fake.calls.exchange += 1;
      fake.verifiers.push(input.codeVerifier);
      return { accessToken: ACCESS_1, refreshToken: REFRESH_1, expiresInSeconds: fake.expiresIn, accountEmail: "person@example.test" };
    },
    async refresh(): Promise<TokenSet> {
      fake.calls.refresh += 1;
      if (fake.nextRefresh === "invalid_grant") throw new OAuthInvalidGrantError();
      if (fake.nextRefresh === "transient") throw new Error("network down");
      return { accessToken: ACCESS_2, refreshToken: null, expiresInSeconds: 3600 };
    },
    async revoke(token) {
      fake.calls.revoked.push(token);
    },
  };
  return fake;
}

let fake: FakeProvider;
const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = FAKE_KEY;
});
afterAll(() => {
  setOAuthProviderFactory(null);
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});
beforeEach(() => {
  fake = makeFake();
  setOAuthProviderFactory(() => fake);
});

async function setup() {
  const org = await createTestOrganization("OAuth");
  const management = await createTestContext(org.id, "MANAGEMENT", "oa.mgmt");
  const sales = await createTestContext(org.id, "SALES", "oa.sales");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "oa.tech");
  return { org, management, sales, technical };
}

function stateFrom(url: string): string {
  return new URL(url).searchParams.get("state")!;
}

async function connect(ctx: Awaited<ReturnType<typeof setup>>["sales"], kind: "EMAIL" | "CALENDAR" = "EMAIL", extra: { shared?: boolean } = {}) {
  const started = await startConnection(ctx, { kind, provider: "GOOGLE", ...extra });
  return completeConnection(ctx, { state: stateFrom(started.authorizationUrl), code: "fake-code" });
}

describe("encryption at rest", () => {
  it("seals and opens a value, and never stores it readable", () => {
    const sealed = sealSecret("fake-secret-value");
    expect(sealed).not.toContain("fake-secret-value");
    expect(openSecret(sealed)).toBe("fake-secret-value");
    expect(sealSecret("fake-secret-value")).not.toBe(sealed); // a fresh nonce each time
  });

  it("refuses an altered value and a wrong key, and fails closed without a key", () => {
    const sealed = sealSecret("fake-secret-value");
    const parts = sealed.split(".");
    const altered = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".");
    expect(() => openSecret(altered)).toThrow(SecretBoxError);
    process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => openSecret(sealed)).toThrow(SecretBoxError);
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(isSecretBoxConfigured()).toBe(false);
    expect(() => sealSecret("x")).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
    process.env.INTEGRATION_ENCRYPTION_KEY = FAKE_KEY;
  });

  it("keeps tokens as ciphertext in the database and out of every API answer", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    const row = await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: view.id! } });
    expect(row.accessTokenEnc).toBeTruthy();
    expect(row.accessTokenEnc).not.toContain(ACCESS_1);
    expect(row.refreshTokenEnc).not.toContain(REFRESH_1);
    expect(openSecret(row.accessTokenEnc!)).toBe(ACCESS_1);
    expect(openSecret(row.refreshTokenEnc!)).toBe(REFRESH_1);
    // The PKCE verifier is sealed too.
    const state = await adminDb.oAuthState.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(state.codeVerifierEnc).not.toContain(fake.verifiers[0]!);
    const serialised = JSON.stringify([view, await listConnections(sales), await listOrganizationConnections(await createTestContext(org.id, "MANAGEMENT", "oa.m2"))]);
    expect(serialised).not.toContain(ACCESS_1);
    expect(serialised).not.toContain(REFRESH_1);
    expect(serialised).not.toMatch(/TokenEnc|codeVerifier/);
    // Nothing a log line could carry from the audit trail either.
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { startsWith: "oauth." } } });
    expect(JSON.stringify(audit)).not.toContain(ACCESS_1);
    expect(JSON.stringify(audit)).not.toContain(REFRESH_1);
  });
});

describe("starting a connection", () => {
  it("asks the provider only for the scopes the purpose needs", async () => {
    const { sales } = await setup();
    const email = await startConnection(sales, { kind: "EMAIL", provider: "GOOGLE" });
    expect(email.scopes).toEqual(SCOPES.GOOGLE.EMAIL);
    expect(email.scopes.some((s) => s.includes("calendar"))).toBe(false);
    expect(email.scopes.some((s) => s.endsWith("gmail.modify") || s.endsWith("mail.google.com/"))).toBe(false);
    const calendar = await startConnection(sales, { kind: "CALENDAR", provider: "MICROSOFT" });
    expect(calendar.scopes).toEqual(SCOPES.MICROSOFT.CALENDAR);
    expect(calendar.scopes.some((s) => s.startsWith("Mail."))).toBe(false);
    // Mail and meeting links are covered by the two sets together: read, send, events.
    expect(SCOPES.GOOGLE.EMAIL.join()).toContain("gmail.send");
    expect(SCOPES.MICROSOFT.EMAIL.join()).toContain("Mail.Send");
    expect(SCOPES.GOOGLE.CALENDAR.join()).toContain("calendar.events");
    expect(SCOPES.MICROSOFT.CALENDAR.join()).toContain("Calendars.ReadWrite");
  });

  it("stores only the hash of the state, with a challenge instead of the verifier in the address", async () => {
    const { sales, org } = await setup();
    const started = await startConnection(sales, { kind: "EMAIL", provider: "GOOGLE" });
    const state = stateFrom(started.authorizationUrl);
    const row = await adminDb.oAuthState.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(row.stateHash).not.toBe(state);
    expect(started.authorizationUrl).not.toContain(openSecret(row.codeVerifierEnc));
    expect(await organizationSlugForState(state)).toBe(org.slug);
    expect(await organizationSlugForState("not-a-state")).toBeNull();
  });

  it("checks the person may connect that kind, and that only Management connects a shared one", async () => {
    const { sales, technical } = await setup();
    await expect(startConnection(technical, { kind: "EMAIL", provider: "GOOGLE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startConnection(sales, { kind: "EMAIL", provider: "GOOGLE", shared: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startConnection(sales, { kind: "EMAIL", provider: "YAHOO" })).rejects.toBeInstanceOf(ValidationError);
    await expect(startConnection(sales, { kind: "FAX", provider: "GOOGLE" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("completing a connection", () => {
  it("connects once, replaces a live connection in place, and audits it", async () => {
    const { sales, org } = await setup();
    const first = await connect(sales);
    expect(first).toMatchObject({ state: "CONNECTED", provider: "GOOGLE", accountEmail: "person@example.test", mine: true, shared: false });
    const second = await connect(sales);
    expect(second.id).toBe(first.id);
    expect(await adminDb.oAuthConnection.count({ where: { organizationId: org.id, membershipId: sales.membershipId, kind: "EMAIL" } })).toBe(1);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "oauth.connected" } })).toBe(2);
  });

  it("refuses a state that is reused, expired, someone else's or from another organisation", async () => {
    const { sales, management, org } = await setup();
    const started = await startConnection(sales, { kind: "EMAIL", provider: "GOOGLE" });
    const state = stateFrom(started.authorizationUrl);
    await expect(completeConnection(management, { state, code: "c" })).rejects.toBeInstanceOf(ValidationError); // another person
    const other = await createTestOrganization("OAuthOther");
    const stranger = await createTestContext(other.id, "SALES", "oa.stranger");
    await expect(completeConnection(stranger, { state, code: "c" })).rejects.toBeInstanceOf(ValidationError); // another organisation
    await completeConnection(sales, { state, code: "c" });
    await expect(completeConnection(sales, { state, code: "c" })).rejects.toBeInstanceOf(ValidationError); // used
    expect(fake.calls.exchange).toBe(1);

    const again = await startConnection(sales, { kind: "CALENDAR", provider: "GOOGLE" });
    await adminDb.oAuthState.updateMany({ where: { organizationId: org.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(completeConnection(sales, { state: stateFrom(again.authorizationUrl), code: "c" })).rejects.toBeInstanceOf(ValidationError);
    await expect(completeConnection(sales, { state: "", code: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a grant that came without offline access", async () => {
    const { sales } = await setup();
    fake.exchangeCode = async () => ({ accessToken: ACCESS_1, refreshToken: null, expiresInSeconds: 3600 });
    const started = await startConnection(sales, { kind: "EMAIL", provider: "GOOGLE" });
    await expect(completeConnection(sales, { state: stateFrom(started.authorizationUrl), code: "c" })).rejects.toBeInstanceOf(ValidationError);
    expect(await adminDb.oAuthConnection.count({ where: { membershipId: sales.membershipId } })).toBe(0);
  });

  it("lets Management connect one shared mailbox that members then use", async () => {
    const { management, sales } = await setup();
    const shared = await connect(management, "EMAIL", { shared: true });
    expect(shared.shared).toBe(true);
    const seen = (await listConnections(sales)).items.find((i) => i.kind === "EMAIL")!;
    expect(seen).toMatchObject({ state: "CONNECTED", shared: true, mine: false });
    // The member's own connection wins over the shared one.
    await connect(sales);
    expect((await listConnections(sales)).items.find((i) => i.kind === "EMAIL")).toMatchObject({ shared: false, mine: true });
  });
});

describe("status for the screens", () => {
  it("says DISCONNECTED, with a reason, when nothing is connected", async () => {
    const { sales } = await setup();
    const items = (await listConnections(sales)).items;
    const email = items.find((i) => i.kind === "EMAIL")!;
    expect(email).toMatchObject({ state: "DISCONNECTED", id: null, provider: null });
    expect(email.stateReason).toMatch(/no mailbox/i);
    expect(items.find((i) => i.kind === "CALENDAR")!.state).toBe("DISCONNECTED");
  });

  it("is per person: nobody sees another member's connection", async () => {
    const { sales, management } = await setup();
    await connect(sales);
    expect((await listConnections(management)).items.find((i) => i.kind === "EMAIL")!.state).toBe("DISCONNECTED");
    await expect(listOrganizationConnections(sales)).rejects.toBeInstanceOf(ForbiddenError);
    const all = await listOrganizationConnections(management);
    expect(all.items).toHaveLength(1);
    expect(all.items[0]!.memberName).toBeTruthy();
  });
});

describe("token lifecycle", () => {
  it("returns the stored token while it is fresh and refreshes it when it is about to expire", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    expect((await getAccessToken(org.id, view.id!)).token).toBe(ACCESS_1);
    expect(fake.calls.refresh).toBe(0);
    await adminDb.oAuthConnection.update({ where: { id: view.id! }, data: { tokenExpiresAt: new Date(Date.now() + 30_000) } });
    const refreshed = await getAccessToken(org.id, view.id!);
    expect(refreshed.token).toBe(ACCESS_2);
    expect(fake.calls.refresh).toBe(1);
    const row = await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: view.id! } });
    expect(openSecret(row.accessTokenEnc!)).toBe(ACCESS_2);
    expect(openSecret(row.refreshTokenEnc!)).toBe(REFRESH_1); // not rotated, so kept
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it("moves to NEEDS_RECONNECT when the provider refuses the refresh token, and stops trying", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    await adminDb.oAuthConnection.update({ where: { id: view.id! }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    fake.nextRefresh = "invalid_grant";
    await expect(getAccessToken(org.id, view.id!)).rejects.toBeInstanceOf(ConnectionUnavailableError);
    const status = (await listConnections(sales)).items.find((i) => i.kind === "EMAIL")!;
    expect(status).toMatchObject({ state: "NEEDS_RECONNECT" });
    expect(status.lastError?.message).toMatch(/connect again/i);
    const before = fake.calls.refresh;
    await expect(getAccessToken(org.id, view.id!)).rejects.toMatchObject({ state: "NEEDS_RECONNECT" });
    expect(fake.calls.refresh).toBe(before);
    // Connecting again heals it.
    fake.nextRefresh = "ok";
    const healed = await connect(sales);
    expect(healed).toMatchObject({ id: view.id, state: "CONNECTED" });
  });

  it("keeps the connection on a passing provider failure and records the error", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    await adminDb.oAuthConnection.update({ where: { id: view.id! }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    fake.nextRefresh = "transient";
    await expect(getAccessToken(org.id, view.id!)).rejects.toThrow("network down");
    const row = await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: view.id! } });
    expect(row.status).toBe("CONNECTED");
    expect(row.lastError).toBeTruthy();
  });

  it("refreshes expiring connections on the job framework, for this organisation only", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    await adminDb.oAuthConnection.update({ where: { id: view.id! }, data: { tokenExpiresAt: new Date(Date.now() + 60_000) } });
    const otherOrg = await createTestOrganization("OAuthJobOther");
    const otherSales = await createTestContext(otherOrg.id, "SALES", "oa.job.other");
    const otherView = await connect(otherSales);
    await adminDb.oAuthConnection.update({ where: { id: otherView.id! }, data: { tokenExpiresAt: new Date(Date.now() + 60_000) } });

    const result = await enqueueAndRunNow({ organizationId: org.id, type: "oauth.refresh" });
    expect(result.outcome).toBe("succeeded");
    expect(result.job?.result).toMatchObject({ checked: 1, refreshed: 1, failed: 0 });
    expect(fake.calls.refresh).toBe(1);
    const untouched = await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: otherView.id! } });
    expect(openSecret(untouched.accessTokenEnc!)).toBe(ACCESS_1);
  });
});

describe("disconnecting", () => {
  it("revokes at the provider, wipes the tokens and stops the sync", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    const out = await disconnectConnection(sales, view.id!);
    expect(out.state).toBe("DISCONNECTED");
    expect(fake.calls.revoked).toEqual([REFRESH_1]);
    const row = await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: view.id! } });
    expect(row).toMatchObject({ status: "REVOKED", accessTokenEnc: null, refreshTokenEnc: null, syncCursor: null });
    expect(row.revokedAt).not.toBeNull();
    await expect(getAccessToken(org.id, view.id!)).rejects.toBeInstanceOf(ConnectionUnavailableError);
    await expect(getUsableConnection(org.id, view.id!)).rejects.toMatchObject({ state: "DISCONNECTED" });
    expect(fake.calls.refresh).toBe(0);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "oauth.disconnected" } })).toBe(1);
    // Disconnecting twice is harmless, and the person can connect again afterwards.
    await disconnectConnection(sales, view.id!);
    const again = await connect(sales);
    expect(again.id).not.toBe(view.id);
  });

  it("stays disconnected locally even when the provider call fails", async () => {
    const { sales } = await setup();
    const view = await connect(sales);
    fake.revoke = async () => {
      throw new Error("provider down");
    };
    expect((await disconnectConnection(sales, view.id!)).state).toBe("DISCONNECTED");
  });

  it("lets only the owner or Management disconnect, and never across organisations", async () => {
    const { sales, management, org } = await setup();
    const colleague = await createTestContext(org.id, "SALES", "oa.colleague");
    const view = await connect(sales);
    await expect(disconnectConnection(colleague, view.id!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateConnectionSettings(colleague, view.id!, { syncEnabled: false })).rejects.toBeInstanceOf(NotFoundError);
    const other = await createTestOrganization("OAuthCross");
    const stranger = await createTestContext(other.id, "MANAGEMENT", "oa.cross");
    await expect(disconnectConnection(stranger, view.id!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getUsableConnection(other.id, view.id!)).rejects.toBeInstanceOf(ConnectionUnavailableError);
    expect((await disconnectConnection(management, view.id!)).state).toBe("DISCONNECTED");
  });

  it("keeps settings (calendar choice, exclusions) on the person's own connection only while it is live", async () => {
    const { sales } = await setup();
    const view = await connect(sales, "CALENDAR");
    const updated = await updateConnectionSettings(sales, view.id!, { calendarId: "primary", excludedAddresses: ["private@example.test"] });
    expect(updated.settings).toMatchObject({ calendarId: "primary", excludedAddresses: ["private@example.test"] });
    await disconnectConnection(sales, view.id!);
    await expect(updateConnectionSettings(sales, view.id!, { calendarId: "other" })).rejects.toBeInstanceOf(ConnectionUnavailableError);
  });
});

describe("row-level security", () => {
  it("hides one organisation's connections and states from another, as the application role", async () => {
    const { sales, org } = await setup();
    const view = await connect(sales);
    const other = await createTestOrganization("OAuthRls");
    const app = getUnscopedAppClientForTests();
    // No organisation context: nothing is visible.
    expect(await app.oAuthConnection.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
    // Another organisation's context cannot read, change or insert into this one.
    await withOrgContext(other.id, async (tx) => {
      expect(await tx.oAuthConnection.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
      expect(await tx.oAuthState.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
      expect((await tx.oAuthConnection.updateMany({ where: { id: view.id! }, data: { status: "REVOKED" } })).count).toBe(0);
      await expect(
        tx.oAuthConnection.create({ data: { organizationId: org.id, membershipId: sales.membershipId, kind: "CALENDAR", provider: "GOOGLE" } }),
      ).rejects.toThrow();
    });
    // The owning organisation sees its own row.
    await withOrgContext(org.id, async (tx) => {
      expect(await tx.oAuthConnection.findMany({ where: { organizationId: org.id } })).toHaveLength(1);
    });
  });
});

describe("the real provider clients (fake provider server)", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "fake-google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "fake-google-secret";
    process.env.MICROSOFT_OAUTH_CLIENT_ID = "fake-ms-client";
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = "fake-ms-secret";
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  function server(handler: (url: string, body: URLSearchParams) => { status: number; json: unknown }) {
    const seen: { url: string; body: URLSearchParams }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      seen.push({ url, body });
      const out = handler(url, body);
      return new Response(JSON.stringify(out.json), { status: out.status });
    }) as unknown as typeof fetch;
    return { impl, seen };
  }

  it("builds a PKCE authorisation address with offline access and the requested scopes only", () => {
    const client = createOAuthProvider("GOOGLE", server(() => ({ status: 200, json: {} })).impl);
    const url = new URL(client.buildAuthorizationUrl({ state: "s1", codeChallenge: "ch1", scopes: SCOPES.GOOGLE.EMAIL, redirectUri: "https://app.test/cb", loginHint: "a@example.test" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("ch1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toBe(SCOPES.GOOGLE.EMAIL.join(" "));
    expect(url.searchParams.get("client_secret")).toBeNull();
    const ms = new URL(createOAuthProvider("MICROSOFT", server(() => ({ status: 200, json: {} })).impl).buildAuthorizationUrl({ state: "s", codeChallenge: "c", scopes: SCOPES.MICROSOFT.EMAIL, redirectUri: "https://app.test/cb" }));
    expect(ms.host).toBe("login.microsoftonline.com");
  });

  it("exchanges a code, reads the account email, and maps invalid_grant and passing failures", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "Person@Example.Test" })).toString("base64url")}.y`;
    const fakeServer = server((_url, body) => {
      if (body.get("grant_type") === "authorization_code") return { status: 200, json: { access_token: "a1", refresh_token: "r1", expires_in: 100, scope: "openid email", id_token: idToken } };
      if (body.get("refresh_token") === "dead") return { status: 400, json: { error: "invalid_grant", error_description: "secret detail dead" } };
      return { status: 503, json: {} };
    });
    const client = createOAuthProvider("GOOGLE", fakeServer.impl);
    const tokens = await client.exchangeCode({ code: "c1", codeVerifier: "v1", redirectUri: "https://app.test/cb" });
    expect(tokens).toMatchObject({ accessToken: "a1", refreshToken: "r1", expiresInSeconds: 100, accountEmail: "person@example.test", scopes: ["openid", "email"] });
    expect(fakeServer.seen[0]!.body.get("code_verifier")).toBe("v1");
    const dead = await client.refresh("dead").catch((e) => e);
    expect(dead).toBeInstanceOf(OAuthInvalidGrantError);
    expect(String(dead.message)).not.toContain("dead");
    await expect(client.refresh("other")).rejects.toMatchObject({ name: "OAuthTransientError" });
  });

  it("revokes at Google and has nothing to call at Microsoft", async () => {
    const google = server(() => ({ status: 200, json: {} }));
    await createOAuthProvider("GOOGLE", google.impl).revoke("tok");
    expect(google.seen[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    const ms = server(() => ({ status: 200, json: {} }));
    await createOAuthProvider("MICROSOFT", ms.impl).revoke("tok");
    expect(ms.seen).toHaveLength(0);
  });

  it("says plainly when the deployment has no client id", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => createOAuthProvider("GOOGLE").buildAuthorizationUrl({ state: "s", codeChallenge: "c", scopes: [], redirectUri: "x" })).toThrow(/not configured/);
  });
});
