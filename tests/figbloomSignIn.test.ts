import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Figbloom sign-in (ERP/CRM_COGNITO_CONTRACT.md): with COGNITO_SIGN_IN=on, people sign in on Figbloom's sign-in page
 * and CRM issues its own session; sign-up and invitations create the Figbloom account through the Platform API. The
 * platform is stubbed here; CRM's side runs against the real test database. With the switch off (every other test
 * file), CRM behaves exactly as before.
 */

const platform = vi.hoisted(() => ({ createUser: vi.fn(), markEmailVerified: vi.fn() }));
vi.mock("../src/auth/figbloom/platformClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/figbloom/platformClient")>()),
  platformClient: () => platform,
}));

import { ValidationError } from "../src/auth/errors";
import { decodeAttempt, encodeAttempt } from "../src/auth/figbloom/attemptCookie";
import { confirmEmailToken, readConfirmEmailToken } from "../src/auth/figbloom/emailConfirm";
import { exchangeCode, FigbloomSignInError, identityFromClaims, newSignInAttempt } from "../src/auth/figbloom/oidc";
import { figbloomPageRedirect } from "../src/auth/figbloom/pageRedirect";
import { PlatformClient, PlatformError } from "../src/auth/figbloom/platformClient";
import {
  authorizeUrl,
  figbloomSettings,
  figbloomSignInEnabled,
  forgotPasswordUrl,
  safeNext,
  signOutUrl,
} from "../src/auth/figbloom/settings";
import { resolveSessionUserId } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import * as authService from "../src/services/authService";
import * as membershipService from "../src/services/membershipService";
import { confirmFigbloomEmail, signInWithFigbloom } from "../src/services/figbloomSignInService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const ENV = {
  COGNITO_SIGN_IN: "on",
  COGNITO_REGION: "eu-west-1",
  COGNITO_CUSTOMERS_POOL_ID: "eu-west-1_TEST",
  COGNITO_CUSTOMERS_DOMAIN: "https://figbloom-test.auth.eu-west-1.amazoncognito.com/",
  CRM_WEB_CLIENT_ID: "crmclient",
  CRM_WEB_CLIENT_SECRET: "not-a-real-secret",
  APP_BASE_URL: "https://crm.example.test/",
};
const settings = () => figbloomSettings(ENV);
const uniqueEmail = (prefix: string) => `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
const client = { userAgent: "vitest", ipAddress: "127.0.0.1", place: null };

describe("settings, links and the switch", () => {
  it("is off unless COGNITO_SIGN_IN is exactly on (any case)", () => {
    expect(figbloomSignInEnabled({})).toBe(false);
    expect(figbloomSignInEnabled({ COGNITO_SIGN_IN: "true" })).toBe(false);
    expect(figbloomSignInEnabled({ COGNITO_SIGN_IN: " ON " })).toBe(true);
  });

  it("names every missing setting, never a value", () => {
    expect(() => figbloomSettings({ COGNITO_SIGN_IN: "on", CRM_WEB_CLIENT_SECRET: "s3cret" })).toThrow(
      /COGNITO_REGION, COGNITO_CUSTOMERS_POOL_ID, COGNITO_CUSTOMERS_DOMAIN, CRM_WEB_CLIENT_ID, APP_BASE_URL/,
    );
    try {
      figbloomSettings({ CRM_WEB_CLIENT_SECRET: "s3cret" });
    } catch (e) {
      expect((e as Error).message).not.toContain("s3cret");
    }
  });

  it("builds the sign-in, forgot-password and sign-out addresses on the pool's domain", () => {
    const s = settings();
    expect(s.issuer).toBe("https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_TEST");
    const auth = new URL(authorizeUrl(s, "st", "ch"));
    expect(auth.origin + auth.pathname).toBe("https://figbloom-test.auth.eu-west-1.amazoncognito.com/oauth2/authorize");
    expect(Object.fromEntries(auth.searchParams)).toEqual({
      response_type: "code",
      client_id: "crmclient",
      redirect_uri: "https://crm.example.test/auth/figbloom/callback",
      scope: "openid email profile",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
    expect(forgotPasswordUrl(s)).toMatch(/^https:\/\/figbloom-test\.auth\.eu-west-1\.amazoncognito\.com\/forgotPassword\?client_id=crmclient&/);
    const out = new URL(signOutUrl(s));
    expect(out.pathname).toBe("/logout");
    expect(out.searchParams.get("logout_uri")).toBe("https://crm.example.test/auth/figbloom/signed-out");
  });

  it("only follows `next` to a path on this site", () => {
    expect(safeNext("/o/acme/deals?x=1")).toBe("/o/acme/deals?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "o/acme", "/login", "/auth/figbloom/start", null, ""]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
  });

  it("redirects /login, /forgot-password and /reset-password only when the switch is on; never /signup or /accept-invite", () => {
    const none = new URLSearchParams();
    expect(figbloomPageRedirect("/login", none, {})).toBeNull();
    expect(figbloomPageRedirect("/login", none, ENV)).toBe("/auth/figbloom/start");
    expect(figbloomPageRedirect("/login", new URLSearchParams({ next: "/o/acme" }), ENV)).toBe("/auth/figbloom/start?next=%2Fo%2Facme");
    expect(figbloomPageRedirect("/login", new URLSearchParams({ next: "https://evil.example" }), ENV)).toBe("/auth/figbloom/start");
    expect(figbloomPageRedirect("/forgot-password", none, ENV)).toContain("/forgotPassword?");
    expect(figbloomPageRedirect("/reset-password", none, ENV)).toContain("/forgotPassword?");
    expect(figbloomPageRedirect("/signup", none, ENV)).toBeNull();
    expect(figbloomPageRedirect("/accept-invite", none, ENV)).toBeNull();
  });
});

describe("the sign-in round trip", () => {
  it("makes a fresh state and an S256 PKCE pair each time, and keeps them through the cookie", () => {
    const a = newSignInAttempt();
    const b = newSignInAttempt();
    expect(a.state).not.toBe(b.state);
    expect(a.codeChallenge).toBe(createHash("sha256").update(a.codeVerifier).digest("base64url"));
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
    const back = decodeAttempt(encodeAttempt({ state: a.state, codeVerifier: a.codeVerifier, next: "/o/acme" }));
    expect(back).toEqual({ state: a.state, codeVerifier: a.codeVerifier, next: "/o/acme" });
    expect(decodeAttempt(encodeAttempt({ state: "s", codeVerifier: "v", next: "//evil" }))?.next).toBeNull();
    expect(decodeAttempt("not-json")).toBeNull();
  });

  it("exchanges the code with the client secret and the verifier; an expired code says so", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "id.tok.en" }), { status: 200 }));
    await expect(exchangeCode(settings(), "the-code", "the-verifier", fetchImpl)).resolves.toBe("id.tok.en");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://figbloom-test.auth.eu-west-1.amazoncognito.com/oauth2/token");
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from("crmclient:not-a-real-secret").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(init.body))).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
      redirect_uri: "https://crm.example.test/auth/figbloom/callback",
    });

    const expired = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(exchangeCode(settings(), "c", "v", expired)).rejects.toMatchObject({ code: "sign_in_expired" });
    const down = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(exchangeCode(settings(), "c", "v", down)).rejects.toMatchObject({ code: "sign_in_unreachable" });
  });

  it("reads the identity from verified claims, email lower-cased", () => {
    expect(identityFromClaims({ sub: "abc", email: " Esther@Acme.CO ", email_verified: "true", name: "Esther" })).toEqual({
      sub: "abc",
      email: "esther@acme.co",
      emailVerified: true,
      name: "Esther",
    });
    expect(() => identityFromClaims({ email: "x@y.z" })).toThrow(FigbloomSignInError);
  });
});

describe("the Platform API client", () => {
  const config = { apiUrl: "https://api.example.test/", tokenUrl: "https://auth.example.test/oauth2/token", clientId: "svc", clientSecret: "svc-secret" };

  it("gets a token once, reuses it, retries once on 401, and passes the platform's error code on", async () => {
    const calls: string[] = [];
    let apiAnswers = [401, 201];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: `t${calls.length}`, expires_in: 3600 }));
      const status = apiAnswers.shift() ?? 400;
      if (status === 400) return new Response(JSON.stringify({ error: { code: "invalid_password", message: "At least 8 characters" } }), { status });
      return new Response(JSON.stringify({ user_sub: "sub-1", created: true }), { status });
    }) as unknown as typeof fetch;
    const c = new PlatformClient({ ...config, apiUrl: config.apiUrl.replace(/\/$/, "") }, fetchImpl);

    await expect(c.createUser({ email: "a@b.c", name: "A", password: "pw" })).resolves.toEqual({ user_sub: "sub-1", created: true });
    expect(calls.filter((u) => u.endsWith("/oauth2/token"))).toHaveLength(2); // a fresh token after the 401
    apiAnswers = [400];
    await expect(c.createUser({ email: "a@b.c", name: "A", password: "x" })).rejects.toMatchObject({
      code: "invalid_password",
      status: 400,
      message: "At least 8 characters",
    });
    expect(calls.filter((u) => u.endsWith("/oauth2/token"))).toHaveLength(2); // the token was reused
  });
});

describe("the confirm-email link", () => {
  it("round-trips, and refuses a forged, expired or differently-keyed token", () => {
    const token = confirmEmailToken({ id: "u1", identitySub: "s1" }, "key-a", 1_000);
    expect(readConfirmEmailToken(token, "key-a", 2_000)).toEqual({ uid: "u1", sub: "s1" });
    expect(readConfirmEmailToken(token, "key-b", 2_000)).toBeNull();
    expect(readConfirmEmailToken(token, "key-a", 1_000 + 15 * 86_400_000)).toBeNull();
    const [payload, signature] = token.split(".");
    expect(readConfirmEmailToken(`${payload}x.${signature}`, "key-a", 2_000)).toBeNull();
    expect(readConfirmEmailToken("nonsense", "key-a")).toBeNull();
  });
});

describe("with Figbloom sign-in on (against the test database)", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    platform.createUser.mockReset();
    platform.markEmailVerified.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs a new Figbloom account in with no organisation (awaiting access), then finds it by its sub", async () => {
    const email = uniqueEmail("from.hr");
    const sub = randomUUID();
    const first = await signInWithFigbloom({ sub, email, emailVerified: true, name: "From HR" }, client);
    expect(first.awaitingAccess).toBe(true);
    expect(first.organizationSlug).toBeNull();
    expect(await resolveSessionUserId(first.token)).toBe(first.userId);
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(user).toMatchObject({ email, identitySub: sub, passwordHash: null });

    const again = await signInWithFigbloom({ sub, email: "changed@example.test", emailVerified: true, name: null }, client);
    expect(again.userId).toBe(first.userId);
    const events = await adminDb.signInEvent.findMany({ where: { userId: first.userId, outcome: "SUCCESS" } });
    expect(events.map((e) => e.reason)).toEqual(["FIGBLOOM", "FIGBLOOM"]);
  });

  it("links an existing CRM user by a verified email only, and lands in their organisation", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } });

    await expect(
      signInWithFigbloom({ sub: randomUUID(), email: user.email.toUpperCase(), emailVerified: false, name: null }, client),
    ).rejects.toMatchObject({ code: "sign_in_failed" });

    const sub = randomUUID();
    const signedIn = await signInWithFigbloom({ sub, email: user.email.toUpperCase(), emailVerified: true, name: null }, client);
    expect(signedIn.userId).toBe(user.id);
    expect(signedIn.organizationSlug).toBe(org.slug);
    expect((await adminDb.user.findUniqueOrThrow({ where: { id: user.id } })).identitySub).toBe(sub);

    // a second Figbloom account can't take over the linked user
    await expect(
      signInWithFigbloom({ sub: randomUUID(), email: user.email, emailVerified: true, name: null }, client),
    ).rejects.toMatchObject({ code: "sign_in_failed" });
  });

  it("refuses an inactive CRM user", async () => {
    const email = uniqueEmail("inactive");
    const sub = randomUUID();
    await adminDb.user.create({ data: { email, name: "Gone", identitySub: sub, status: "INACTIVE" } });
    await expect(signInWithFigbloom({ sub, email, emailVerified: true, name: null }, client)).rejects.toMatchObject({
      code: "account_inactive",
    });
  });

  it("sign-up creates the Figbloom account with the form's password, keeps no password in CRM, and emails the confirm link", async () => {
    const email = uniqueEmail("signup");
    platform.createUser.mockResolvedValue({ user_sub: "sub-signup-" + randomUUID(), created: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await authService.signup(email, "Str0ng!Password", "New Person");
    expect(platform.createUser).toHaveBeenCalledWith({ email, name: "New Person", password: "Str0ng!Password", emailProven: false });
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.passwordHash).toBeNull();
    expect(user.identitySub).toMatch(/^sub-signup-/);
    expect(await resolveSessionUserId(result.token)).toBe(user.id);
    const mail = log.mock.calls.map((c) => String(c[0])).find((m) => m.includes("[figbloom-confirm-email]"));
    expect(mail).toContain("https://crm.example.test/auth/figbloom/confirm-email?token=");
    log.mockRestore();
  });

  it("sign-up: an existing Figbloom account, or a password the pool refuses, is a clear error and creates nothing", async () => {
    const email = uniqueEmail("exists");
    platform.createUser.mockResolvedValue({ user_sub: "s", created: false });
    await expect(authService.signup(email, "Str0ng!Password", "X")).rejects.toThrow("You already have a Figbloom account");
    platform.createUser.mockRejectedValue(new PlatformError("Use upper and lower case, a digit and a symbol", 400, "invalid_password"));
    await expect(authService.signup(email, "longenoughbutweak", "X")).rejects.toThrow(ValidationError);
    expect(await adminDb.user.findFirst({ where: { email } })).toBeNull();
  });

  it("accepting an invitation creates (or links) the Figbloom account before spending the token", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("invitee");
    let token = "";
    await membershipService.inviteMember(management, { email, name: "Invitee", roleKey: "SALES" }, (t) => (token = t));

    expect(await authService.getInviteInfo(token)).toEqual({ email, requiresPassword: true });

    // the pool refuses the password: the invite is still usable
    platform.createUser.mockRejectedValueOnce(new PlatformError("Add a symbol", 400, "invalid_password"));
    await expect(authService.acceptMembershipInvite(token, "nosymbolhere1")).rejects.toThrow(ValidationError);

    const sub = "sub-invitee-" + randomUUID();
    platform.createUser.mockResolvedValueOnce({ user_sub: sub, created: false });
    const accepted = await authService.acceptMembershipInvite(token, "Str0ng!Password");
    expect(platform.createUser).toHaveBeenLastCalledWith({ email, name: "Invitee", password: "Str0ng!Password", emailProven: true });
    expect(accepted.organizationSlug).toBe(org.slug);
    expect(accepted.notice).toMatch(/already had a Figbloom account/);
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(user).toMatchObject({ identitySub: sub, passwordHash: null });
  });

  it("an invitee already linked to Figbloom accepts without a password", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("linked");
    await adminDb.user.create({ data: { email, name: "Linked", identitySub: "sub-linked-" + randomUUID() } });
    let token = "";
    await membershipService.inviteMember(management, { email, name: "Linked", roleKey: "SALES" }, (t) => (token = t));
    expect((await authService.getInviteInfo(token)).requiresPassword).toBe(false);
    const accepted = await authService.acceptMembershipInvite(token, undefined);
    expect(accepted.organizationSlug).toBe(org.slug);
    expect(platform.createUser).not.toHaveBeenCalled();
  });

  it("the confirm-email link marks the account verified only for the user it was made for", async () => {
    const sub = "sub-confirm-" + randomUUID();
    const user = await adminDb.user.create({ data: { email: uniqueEmail("confirm"), name: "C", identitySub: sub } });
    platform.markEmailVerified.mockResolvedValue({});
    expect(await confirmFigbloomEmail({ uid: user.id, sub })).toBe(true);
    expect(platform.markEmailVerified).toHaveBeenCalledWith(sub);
    expect(await confirmFigbloomEmail({ uid: user.id, sub: "someone-else" })).toBe(false);
    expect(platform.markEmailVerified).toHaveBeenCalledTimes(1);
  });

  it("password sign-in is refused with 410 (use Figbloom sign-in)", async () => {
    const { POST: login } = await import("../src/app/api/auth/login/route");
    const res = await login(new Request("https://crm.example.test/api/auth/login", { method: "POST", body: "{}" }));
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("use_figbloom_sign_in");
  });
});
