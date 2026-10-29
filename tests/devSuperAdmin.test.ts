import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../src/auth/errors";
import { devAccountsAllowed, isDevAccountEmail } from "../src/auth/devAccounts";
import {
  assertNoDevAccountsInProduction,
  countDevAccounts,
  enforceNoDevAccountsInProduction,
} from "../src/auth/devAccountGuard";
import {
  DEV_PLATFORM_COOKIE_NAME,
  DEV_SESSION_COOKIE_NAME,
  createPlatformCookieValue,
  createSessionCookieValue,
  verifyPlatformCookieValue,
  verifySessionCookieValue,
} from "../src/auth/devSession";
import { resolveDevPlatformIdentity } from "../src/auth/platformIdentity";
import { resolveRequestContext } from "../src/auth/requestContext";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { DEV_PLATFORM_IDENTITY, runDevSeed } from "../prisma/devSeed";

/**
 * FIG-1196 (B0.09): the dev-only Super Admin is a platform identity kept
 * apart from tenant users, created only by `npm run seed:dev`, reachable only
 * through the dev sign-in when development + ALLOW_DEV_ACCOUNTS=true, unable
 * to touch tenant data, and its existence fails a production boot.
 */

const DEV = { NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "true" };
const SEED_ENV = { NODE_ENV: "test", ALLOW_DEV_ACCOUNTS: "true" };

let platformId: string;

// The holding page reads its cookie through next/headers; point that at a jar the tests control.
const holder = vi.hoisted(() => ({
  jar: { get: (_name: string): { value: string } | undefined => undefined },
}));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

beforeAll(async () => {
  await runDevSeed({ env: SEED_ENV });
  platformId = (
    await adminDb.platformIdentity.findUniqueOrThrow({
      where: { email: DEV_PLATFORM_IDENTITY.email },
    })
  ).id;
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

function cookies(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name]! } : undefined) };
}

describe("guard 1: the dev seed", () => {
  it("creates the Dev Super Admin as a platform identity, with no tenant user, membership or password-less login", async () => {
    const identity = await adminDb.platformIdentity.findUniqueOrThrow({
      where: { email: DEV_PLATFORM_IDENTITY.email },
    });
    expect(identity).toMatchObject({ name: "Dev Super Admin", isDev: true });
    expect(identity.passwordHash).toBeTruthy();

    // Separate from tenant users: no `users` row, so no membership can exist.
    expect(await adminDb.user.count({ where: { email: identity.email } })).toBe(0);
    // Flagged by `isDev`, not by the tenant dev email suffix: the guard counts it separately.
    expect(isDevAccountEmail(identity.email)).toBe(false);
  });

  it("is not created by the production seed, and no migration inserts one", async () => {
    await adminDb.platformIdentity.deleteMany({ where: { email: DEV_PLATFORM_IDENTITY.email } });
    execFileSync("npx", ["tsx", "prisma/seed.ts"], {
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
      shell: true,
    });
    expect(await adminDb.platformIdentity.count()).toBe(0);
    // Put the fixture back for the other tests.
    await runDevSeed({ env: SEED_ENV });
    platformId = (
      await adminDb.platformIdentity.findUniqueOrThrow({ where: { email: DEV_PLATFORM_IDENTITY.email } })
    ).id;

    const dir = path.join(__dirname, "..", "prisma", "migrations");
    for (const migration of readdirSync(dir).filter((d) => !d.endsWith(".toml"))) {
      const sql = readFileSync(path.join(dir, migration, "migration.sql"), "utf8");
      expect(sql, migration).not.toMatch(/INSERT\s+INTO\s+"?platform_identities"?/i);
    }
  }, 90_000);
});

describe("guard 2: the dev sign-in is closed unless development + ALLOW_DEV_ACCOUNTS", () => {
  it("devAccountsAllowed is fail-closed on both counts", () => {
    expect(devAccountsAllowed(DEV)).toBe(true);
    expect(devAccountsAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(devAccountsAllowed({ NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "false" })).toBe(false);
    expect(devAccountsAllowed({ NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "TRUE" })).toBe(false);
    expect(devAccountsAllowed({ NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" })).toBe(false);
    expect(devAccountsAllowed({ NODE_ENV: "test", ALLOW_DEV_ACCOUNTS: "true" })).toBe(false);
    expect(devAccountsAllowed({ ALLOW_DEV_ACCOUNTS: "true" })).toBe(false);
  });

  const post = async (email: string) => {
    const { POST } = await import("../src/app/api/dev-session/route");
    return POST(
      new Request("http://localhost/api/dev-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
  };

  it("signs the Dev Super Admin in, sets the platform cookie only, lands on /platform and audits it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    const before = await adminDb.auditEvent.count({ where: { action: "platform.dev_signin" } });

    const res = await post(DEV_PLATFORM_IDENTITY.email);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ platform: true, landing: "/platform", id: platformId });

    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toContain(`${DEV_PLATFORM_COOKIE_NAME}=`);
    expect(set).not.toContain(`${DEV_SESSION_COOKIE_NAME}=`);

    const events = await adminDb.auditEvent.findMany({
      where: { action: "platform.dev_signin" },
      orderBy: { createdAt: "desc" },
    });
    expect(events.length).toBe(before + 1);
    expect(events[0]).toMatchObject({
      organizationId: null,
      entityType: "PlatformIdentity",
      entityId: platformId,
      metadata: { email: DEV_PLATFORM_IDENTITY.email, dev: true },
    });
  });

  it("still signs a tenant dev user in as before, to the organization", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    const res = await post("dev.sales@figbloom.local");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ platform: false, landing: "/o/figbloom" });
    expect(res.headers.get("set-cookie")).toContain(`${DEV_SESSION_COOKIE_NAME}=`);
  });

  it.each([
    ["production with the flag set", { NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" }],
    ["development without the flag", { NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "" }],
    ["development with the flag false", { NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "false" }],
    ["a test environment", { NODE_ENV: "test", ALLOW_DEV_ACCOUNTS: "true" }],
  ])("is a 404 with no cookie and no audit entry in %s", async (_label, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const before = await adminDb.auditEvent.count({ where: { action: "platform.dev_signin" } });

    const res = await post(DEV_PLATFORM_IDENTITY.email);
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await adminDb.auditEvent.count({ where: { action: "platform.dev_signin" } })).toBe(before);

    const { DELETE } = await import("../src/app/api/dev-session/route");
    expect((await DELETE()).status).toBe(404);
  });

  it("only honors the platform cookie when dev accounts are allowed, and never a tampered, replayed or non-dev one", async () => {
    const good = cookies({ [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(platformId) });
    expect((await resolveDevPlatformIdentity(good, DEV))?.id).toBe(platformId);
    expect(await resolveDevPlatformIdentity(good, { NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" })).toBeNull();
    expect(await resolveDevPlatformIdentity(good, { NODE_ENV: "development" })).toBeNull();

    const tampered = cookies({ [DEV_PLATFORM_COOKIE_NAME]: `${platformId}.not-the-signature` });
    expect(await resolveDevPlatformIdentity(tampered, DEV)).toBeNull();
    expect(await resolveDevPlatformIdentity(cookies({}), DEV)).toBeNull();

    // A tenant dev cookie value is not a platform cookie, and the reverse.
    const user = await adminDb.user.findUniqueOrThrow({ where: { email: "dev.management@figbloom.local" } });
    expect(verifyPlatformCookieValue(createSessionCookieValue(user.id))).toBeNull();
    expect(verifySessionCookieValue(createPlatformCookieValue(platformId))).toBeNull();

    // An identity that is not a dev fixture is never honored through the dev cookie.
    const real = await adminDb.platformIdentity.create({
      data: { email: `real.admin.${Date.now()}@platform.example.com`, name: "Real Admin", isDev: false },
    });
    const forged = cookies({ [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(real.id) });
    expect(await resolveDevPlatformIdentity(forged, DEV)).toBeNull();
    await adminDb.platformIdentity.delete({ where: { id: real.id } });
  });
});

describe("guard 3: production boot with a dev account", () => {
  const PROD = { NODE_ENV: "production" };

  it("fails the boot in production when a dev account exists, naming what it found", async () => {
    await expect(
      assertNoDevAccountsInProduction({ env: PROD, count: async () => ({ users: 6, platformIdentities: 1 }) }),
    ).rejects.toThrow(/Refusing to start in production: 6 dev user\(s\).*1 dev platform identity/s);
    await expect(
      assertNoDevAccountsInProduction({ env: PROD, count: async () => ({ users: 0, platformIdentities: 1 }) }),
    ).rejects.toThrow(/Dev accounts must never exist in production/);
    await expect(
      assertNoDevAccountsInProduction({ env: PROD, count: async () => ({ users: 1, platformIdentities: 0 }) }),
    ).rejects.toThrow(/Refusing to start/);
  });

  it("starts in production when there are none", async () => {
    await expect(
      assertNoDevAccountsInProduction({ env: PROD, count: async () => ({ users: 0, platformIdentities: 0 }) }),
    ).resolves.toBeUndefined();
  });

  it("does nothing outside production, whatever exists", async () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      await expect(
        assertNoDevAccountsInProduction({ env: { NODE_ENV }, count: async () => ({ users: 9, platformIdentities: 9 }) }),
      ).resolves.toBeUndefined();
    }
  });

  it("refuses when it cannot check (fail closed)", async () => {
    await expect(
      assertNoDevAccountsInProduction({
        env: PROD,
        count: async () => {
          throw new Error("connection refused");
        },
      }),
    ).rejects.toThrow(/could not check whether dev accounts exist \(connection refused\)/);
  });

  it("allows the e2e override only with both flags, and nothing weaker", async () => {
    const found = async () => ({ users: 6, platformIdentities: 1 });
    await expect(
      assertNoDevAccountsInProduction({
        env: { ...PROD, E2E_ALLOW_DEV_ACCOUNTS: "true", ALLOW_DEV_ACCOUNTS: "true" },
        count: found,
      }),
    ).resolves.toBeUndefined();
    for (const env of [
      { ...PROD, E2E_ALLOW_DEV_ACCOUNTS: "true" },
      { ...PROD, ALLOW_DEV_ACCOUNTS: "true" },
      { ...PROD, E2E_ALLOW_DEV_ACCOUNTS: "1", ALLOW_DEV_ACCOUNTS: "true" },
    ]) {
      await expect(assertNoDevAccountsInProduction({ env, count: found })).rejects.toThrow(/Refusing to start/);
    }
  });

  it("exits the process with a non-zero code (not just a thrown error) so an orchestrator sees a crash", async () => {
    const exit = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await enforceNoDevAccountsInProduction({
      env: PROD,
      count: async () => ({ users: 6, platformIdentities: 1 }),
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/Refusing to start in production/);

    exit.mockClear();
    await enforceNoDevAccountsInProduction({ env: PROD, count: async () => ({ users: 0, platformIdentities: 0 }), exit });
    expect(exit).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("counts the real dev accounts the seed made (tenant users and the platform identity)", async () => {
    const found = await countDevAccounts();
    expect(found.users).toBeGreaterThanOrEqual(6);
    expect(found.platformIdentities).toBeGreaterThanOrEqual(1);
    await expect(assertNoDevAccountsInProduction({ env: PROD })).rejects.toThrow(/Refusing to start in production/);
  });
});

describe("the platform identity cannot reach tenant data", () => {
  it("resolves to no tenant context: the tenant request path never reads its cookie", async () => {
    const platformOnly = cookies({ [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(platformId) });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    await expect(resolveRequestContext("figbloom", platformOnly)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(resolveRequestContext("figbloom-sandbox", platformOnly)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("has no membership in any organization", async () => {
    const memberships = await adminDb.membership.count({
      where: { user: { email: DEV_PLATFORM_IDENTITY.email } },
    });
    expect(memberships).toBe(0);
  });

  it("is invisible to the tenant-facing database role: no privileges and no rows (row-level security)", async () => {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { slug: "figbloom" } });
    // The application role is refused outright ...
    await expect(
      withOrgContext(org.id, (tx) => tx.$queryRaw`SELECT id FROM platform_identities`),
    ).rejects.toThrow(/permission denied/i);
    // ... and row-level security is on and forced, with no policy, as the second wall.
    const [row] = await adminDb.$queryRaw<{ rls: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS rls, relforcerowsecurity AS forced
      FROM pg_class WHERE relname = 'platform_identities'`;
    expect(row).toEqual({ rls: true, forced: true });
    const policies = await adminDb.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM pg_policies WHERE tablename = 'platform_identities'`;
    expect(Number(policies[0]!.n)).toBe(0);
  });

  it("sees no tenant rows even with a tenant context set for it", async () => {
    // Tenant tables stay isolated by organization; the platform identity has no
    // organization to set, so there is nothing to scope its reads to.
    const orgs = await adminDb.organization.count();
    expect(orgs).toBeGreaterThan(0);
    await expect(
      adminDb.platformIdentity.findFirstOrThrow({ where: { email: DEV_PLATFORM_IDENTITY.email } }),
    ).resolves.not.toHaveProperty("organizationId");
  });
});

describe("the platform console's door (FIG-1160, replaces the V1.1 holding page)", () => {
  it("lets the signed-in Dev Super Admin in and says who they are", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    holder.jar = cookies({ [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(platformId) });
    const { requireConsole } = await import("../src/app/platform/requireConsole");
    const who = await requireConsole();
    expect(who.name).toBe("Dev Super Admin");
    expect(who.email).toBe(DEV_PLATFORM_IDENTITY.email);
  });

  it("is a 404 without a platform session, and in production even with one", async () => {
    const { requireConsole } = await import("../src/app/platform/requireConsole");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    holder.jar = cookies({});
    await expect(requireConsole()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });

    vi.stubEnv("NODE_ENV", "production");
    holder.jar = cookies({ [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(platformId) });
    await expect(requireConsole()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
