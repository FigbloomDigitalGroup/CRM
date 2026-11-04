import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../src/auth/errors";
import { PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_KEYS, platformPermissionKeysFor } from "../src/auth/platformPermissions";
import {
  PLATFORM_SESSION_COOKIE_NAME,
  createPlatformSession,
  hashPlatformToken,
  lookupPlatformSession,
  resolvePlatformContext,
  revokePlatformSession,
  revokePlatformSessionsFor,
} from "../src/auth/platformSession";
import { resolveRequestContext } from "../src/auth/requestContext";
import { SESSION_COOKIE_NAME, createSession, lookupSession } from "../src/auth/session";
import { createPlatformCookieValue, DEV_PLATFORM_COOKIE_NAME } from "../src/auth/devSession";
import { adminDb } from "../src/db/adminClient";
import { appDb } from "../src/db/orgScopedClient";
import { getPlatformDb } from "../src/db/platformClient";
import { createCompany } from "../src/repositories/companies";
import { listOrganizationCounts } from "../src/services/platformOverviewService";
import { PERMISSIONS } from "../prisma/seedData";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";

/**
 * FIG-1135 (B6.03): the platform identity foundation, tested in both directions.
 *
 *   1. A platform session cannot query tenant data: the platform database role
 *      has no privilege on any tenant table, RLS and tenant context do not
 *      change that, and the only window onto tenant data is a counts-only view.
 *   2. Tenant users cannot reach platform routes: the tenant session is never
 *      read as a platform session, tenant keys are not platform keys, and the
 *      tenant application role cannot read the platform tables.
 */

// The route handlers read their cookies through next/headers; point that at a jar the tests control.
const holder = vi.hoisted(() => ({
  jar: { get: (_name: string): { value: string } | undefined => undefined },
}));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));

const PLATFORM_TABLES = ["platform_identities", "platform_sessions"];
const COUNTS_VIEW = "platform_organization_counts";

const created: string[] = [];
async function makePlatformIdentity(overrides: { status?: string } = {}) {
  const identity = await adminDb.platformIdentity.create({
    data: { email: `platform.${randomUUID().slice(0, 8)}@platform.example.com`, name: "Test Platform Admin", isDev: false, ...overrides },
  });
  created.push(identity.id);
  return identity;
}

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name]! } : undefined) };
}

beforeAll(() => {
  // Fail with the fix, not a cryptic connection error, if the platform role is not provisioned.
  expect(process.env.PLATFORM_DATABASE_URL, "PLATFORM_DATABASE_URL (see .env.example)").toBeTruthy();
});

afterEach(() => {
  vi.unstubAllEnvs();
  holder.jar = jar({});
});

afterAll(async () => {
  await adminDb.platformIdentity.deleteMany({ where: { id: { in: created } } });
  await getPlatformDb().$disconnect();
});

describe("platform permission keys", () => {
  it("are all `platform.` keys, and no tenant permission is one", () => {
    expect(PLATFORM_PERMISSION_KEYS.length).toBeGreaterThan(5);
    for (const key of PLATFORM_PERMISSION_KEYS) expect(key.startsWith("platform.")).toBe(true);
    expect(PERMISSIONS.filter((p) => p.key.startsWith("platform."))).toEqual([]);
    const tenant = new Set(PERMISSIONS.map((p) => p.key));
    expect(PLATFORM_PERMISSION_KEYS.filter((k) => tenant.has(k))).toEqual([]);
  });

  it("are not in the tenant catalogue in the database, and no tenant role holds one", async () => {
    expect(await adminDb.permission.count({ where: { key: { startsWith: "platform." } } })).toBe(0);
  });

  it("offer no way to read a customer record, a deal value, a payment or a cost", () => {
    const text = PLATFORM_PERMISSIONS.map((p) => p.key).join(" ");
    expect(text).not.toMatch(/customer|contact|deal|payment|invoice|margin|cost|quote/i);
  });

  it("are held by an active identity only; a suspended one holds none", () => {
    expect(platformPermissionKeysFor("ACTIVE")).toEqual(PLATFORM_PERMISSION_KEYS);
    expect(platformPermissionKeysFor("SUSPENDED")).toEqual([]);
    expect(platformPermissionKeysFor("anything-else")).toEqual([]);
  });
});

describe("the platform database role", () => {
  it("is a login role that is neither a superuser nor able to bypass row-level security", async () => {
    const [role] = await adminDb.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }[]>`
      SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'figbloom_platform'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
    const [{ me }] = await getPlatformDb().$queryRaw<{ me: string }[]>`SELECT current_user::text AS me`;
    expect(me).toBe("figbloom_platform");
  });

  it("holds no privilege at all on any table except its own two and the counts view", async () => {
    const rows = await adminDb.$queryRaw<{ name: string; privilege: string }[]>`
      SELECT c.relname AS name, p.privilege
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
      WHERE c.relkind IN ('r', 'v', 'p', 'm')
        AND has_table_privilege('figbloom_platform', c.oid, p.privilege)`;
    const granted = new Map<string, string[]>();
    for (const r of rows) granted.set(r.name, [...(granted.get(r.name) ?? []), r.privilege]);

    expect([...granted.keys()].sort()).toEqual([COUNTS_VIEW, ...PLATFORM_TABLES].sort());
    expect(granted.get(COUNTS_VIEW)).toEqual(["SELECT"]);
    for (const t of PLATFORM_TABLES) expect(granted.get(t)!.sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("is refused by the database on every tenant table, read and write", async () => {
    const tables = await adminDb.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%' AND tablename <> ALL(${PLATFORM_TABLES})`;
    expect(tables.length).toBeGreaterThan(40);

    const db = getPlatformDb();
    for (const { tablename } of tables) {
      await expect(db.$queryRawUnsafe(`SELECT 1 FROM "${tablename}" LIMIT 1`), `SELECT ${tablename}`).rejects.toThrow(/permission denied/i);
    }
    for (const t of ["companies", "deals", "payment_records", "invoices", "users", "sessions", "memberships", "audit_events", "organizations"]) {
      await expect(db.$executeRawUnsafe(`DELETE FROM "${t}"`), `DELETE ${t}`).rejects.toThrow(/permission denied/i);
      await expect(db.$executeRawUnsafe(`UPDATE "${t}" SET id = id`), `UPDATE ${t}`).rejects.toThrow(/permission denied/i);
    }
  });

  it("stays refused when it sets a tenant context itself (RLS is not what it is relying on)", async () => {
    const org = await createTestOrganization();
    await createCompany({ organizationId: org.id, name: "Secret Customer Ltd" });
    await expect(
      getPlatformDb().$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${org.id}, true)`;
        return tx.$queryRaw`SELECT name FROM companies`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot change its own privileges", async () => {
    // (A GRANT by a non-owner is only a warning in Postgres, so check the outcome rather than an error.)
    await getPlatformDb().$executeRawUnsafe(`GRANT SELECT ON "companies" TO figbloom_platform`).catch(() => undefined);
    const [{ ok }] = await adminDb.$queryRaw<{ ok: boolean }[]>`SELECT has_table_privilege('figbloom_platform', 'companies', 'SELECT') AS ok`;
    expect(ok).toBe(false);
    await expect(getPlatformDb().$executeRawUnsafe(`ALTER ROLE figbloom_platform BYPASSRLS`)).rejects.toThrow(/permission denied/i);
    await expect(getPlatformDb().$executeRawUnsafe(`SET ROLE figbloom_app`)).rejects.toThrow(/permission denied/i);
  });
});

describe("operational counts (the only window onto tenant data)", () => {
  it("shows numbers per organisation that match the data, and nothing else", async () => {
    const org = await createTestOrganization();
    await createCompany({ organizationId: org.id, name: "Secret Customer Ltd" });
    await createCompany({ organizationId: org.id, name: "Another Secret Ltd" });
    await createTestMembership(org.id, "SALES");

    const mine = (await listOrganizationCounts()).find((o) => o.organizationId === org.id)!;
    expect(mine).toMatchObject({ slug: org.slug, name: org.name, companyCount: 2, memberCount: 1, activeMemberCount: 1, dealCount: 0, leadCount: 0 });
    expect(JSON.stringify(mine)).not.toMatch(/Secret/);
  });

  it("has only count columns plus the organisation's own name and status (no values, no free text)", async () => {
    const cols = await adminDb.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = ${COUNTS_VIEW} ORDER BY ordinal_position`;
    expect(cols.map((c) => c.column_name)).toEqual([
      "organization_id", "slug", "name", "status", "created_at",
      "member_count", "active_member_count", "company_count", "contact_count", "lead_count", "deal_count",
    ]);
    for (const c of cols.filter((c) => c.column_name.endsWith("_count"))) expect(c.data_type).toBe("bigint");
    expect(cols.map((c) => c.column_name).join(" ")).not.toMatch(/value|amount|price|margin|cost|payment|email|phone/);
  });

  it("is read-only for the platform role", async () => {
    await expect(getPlatformDb().$executeRawUnsafe(`UPDATE "${COUNTS_VIEW}" SET name = 'x'`)).rejects.toThrow(/permission denied|cannot update/i);
  });
});

describe("the tenant application role cannot reach the platform", () => {
  it.each([...PLATFORM_TABLES, COUNTS_VIEW])("is refused outright on %s", async (table) => {
    await expect(appDb.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    await expect(appDb.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(/permission denied/i);
  });

  it("platform tables have RLS on and forced, with a policy for the platform role only", async () => {
    const tables = await adminDb.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(${PLATFORM_TABLES}) AND relkind = 'r'`;
    expect(tables).toHaveLength(2);
    for (const t of tables) expect(t).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });

    const policies = await adminDb.$queryRaw<{ tablename: string; roles: string[] }[]>`
      SELECT tablename, roles::text[] AS roles FROM pg_policies WHERE tablename = ANY(${PLATFORM_TABLES})`;
    expect(policies).toHaveLength(2);
    for (const p of policies) expect(p.roles).toEqual(["figbloom_platform"]);
  });

  it("no tenant table has a policy that names the platform role", async () => {
    const rows = await adminDb.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_policies
      WHERE tablename <> ALL(${PLATFORM_TABLES}) AND 'figbloom_platform' = ANY(roles::text[])`;
    expect(rows).toEqual([]);
  });
});

describe("platform sessions", () => {
  it("stores only a hash of the token, and gives the platform role's view of the identity", async () => {
    const identity = await makePlatformIdentity();
    const made = await createPlatformSession(identity.id, { userAgent: "vitest", ipAddress: "203.0.113.9" });
    const row = await adminDb.platformSession.findUniqueOrThrow({ where: { id: made.sessionId } });
    expect(row.tokenHash).toBe(hashPlatformToken(made.token));
    expect(row.tokenHash).not.toContain(made.token);
    expect(made.absoluteExpiresAt.getTime()).toBeGreaterThan(made.expiresAt.getTime());
    expect((await adminDb.platformIdentity.findUniqueOrThrow({ where: { id: identity.id } })).lastSignInAt).not.toBeNull();

    const found = await lookupPlatformSession(made.token);
    expect(found).toMatchObject({ state: "active", identity: { id: identity.id, status: "ACTIVE" } });
  });

  it("ends on sign-out, revocation, suspension and expiry", async () => {
    const identity = await makePlatformIdentity();

    const a = await createPlatformSession(identity.id);
    await revokePlatformSession(a.token);
    expect(await lookupPlatformSession(a.token)).toEqual({ state: "revoked" });

    const b = await createPlatformSession(identity.id);
    const c = await createPlatformSession(identity.id);
    expect(await revokePlatformSessionsFor(identity.id, "REVOKED")).toBe(2);
    expect((await lookupPlatformSession(b.token)).state).toBe("revoked");
    expect((await lookupPlatformSession(c.token)).state).toBe("revoked");

    const d = await createPlatformSession(identity.id);
    await adminDb.platformIdentity.update({ where: { id: identity.id }, data: { status: "SUSPENDED" } });
    expect((await lookupPlatformSession(d.token)).state).toBe("revoked");
    await expect(createPlatformSession(identity.id)).rejects.toBeInstanceOf(UnauthorizedError);
    await adminDb.platformIdentity.update({ where: { id: identity.id }, data: { status: "ACTIVE" } });

    const e = await createPlatformSession(identity.id);
    await adminDb.platformSession.update({ where: { id: e.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await lookupPlatformSession(e.token)).state).toBe("expired");

    const f = await createPlatformSession(identity.id);
    await adminDb.platformSession.update({ where: { id: f.sessionId }, data: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await lookupPlatformSession(f.token)).state).toBe("expired");

    expect(await lookupPlatformSession("not-a-token")).toEqual({ state: "unknown" });
    expect(await lookupPlatformSession(undefined)).toEqual({ state: "unknown" });
  });

  it("slides the idle expiry but never past the absolute limit", async () => {
    const identity = await makePlatformIdentity();
    const s = await createPlatformSession(identity.id);
    await adminDb.platformSession.update({
      where: { id: s.sessionId },
      data: { absoluteExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 30_000) },
    });
    await lookupPlatformSession(s.token);
    const row = await adminDb.platformSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.absoluteExpiresAt.getTime());
  });

  it("is removed with its identity (no orphan sessions)", async () => {
    const identity = await makePlatformIdentity();
    const s = await createPlatformSession(identity.id);
    await adminDb.platformIdentity.delete({ where: { id: identity.id } });
    expect(await adminDb.platformSession.count({ where: { id: s.sessionId } })).toBe(0);
  });
});

describe("platform and tenant sessions are not interchangeable", () => {
  it("a tenant session token is not a platform session, and the reverse", async () => {
    const org = await createTestOrganization();
    const { user } = await createTestMembership(org.id, "MANAGEMENT");
    const tenant = await createSession(user.id);
    const identity = await makePlatformIdentity();
    const platform = await createPlatformSession(identity.id);

    expect((await lookupPlatformSession(tenant.token)).state).toBe("unknown");
    expect((await lookupSession(platform.token)).state).toBe("unknown");
  });

  it("a platform session cookie gives no tenant context in any organisation", async () => {
    const org = await createTestOrganization();
    const identity = await makePlatformIdentity();
    const platform = await createPlatformSession(identity.id);
    for (const name of [PLATFORM_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME]) {
      await expect(resolveRequestContext(org.slug, jar({ [name]: platform.token }))).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });

  it("a tenant session cookie, even a Management user's, gives no platform context", async () => {
    const org = await createTestOrganization();
    const { user } = await createTestMembership(org.id, "MANAGEMENT");
    const tenant = await createSession(user.id);
    for (const name of [PLATFORM_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME]) {
      expect(await resolvePlatformContext(jar({ [name]: tenant.token }))).toBeNull();
    }
  });

  it("resolves an active platform session to the platform keys, and an ended one to nothing", async () => {
    const identity = await makePlatformIdentity();
    const s = await createPlatformSession(identity.id);
    const ctx = await resolvePlatformContext(jar({ [PLATFORM_SESSION_COOKIE_NAME]: s.token }));
    expect(ctx).toMatchObject({ identityId: identity.id, email: identity.email, source: "session" });
    expect([...ctx!.permissions].sort()).toEqual([...PLATFORM_PERMISSION_KEYS].sort());
    expect(ctx).not.toHaveProperty("organizationId");

    await revokePlatformSession(s.token);
    expect(await resolvePlatformContext(jar({ [PLATFORM_SESSION_COOKIE_NAME]: s.token }))).toBeNull();
  });

  it("a bad platform cookie is never rescued by the dev cookie", async () => {
    const dev = await adminDb.platformIdentity.create({
      data: { email: `dev.${randomUUID().slice(0, 8)}@platform.example.com`, name: "Dev", isDev: true },
    });
    created.push(dev.id);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    const cookies = jar({
      [PLATFORM_SESSION_COOKIE_NAME]: "bad-token",
      [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(dev.id),
    });
    expect(await resolvePlatformContext(cookies)).toBeNull();
    // The dev cookie alone works in development, and only there.
    const devOnly = jar({ [DEV_PLATFORM_COOKIE_NAME]: createPlatformCookieValue(dev.id) });
    expect((await resolvePlatformContext(devOnly))?.source).toBe("dev");
    expect(await resolvePlatformContext(devOnly, { NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" })).toBeNull();
  });
});

describe("platform routes", () => {
  const getRoute = async (path: "organizations" | "me") => {
    const mod =
      path === "me"
        ? await import("../src/app/api/platform/me/route")
        : await import("../src/app/api/platform/organizations/route");
    return mod.GET() as Promise<Response>;
  };

  it("answer 404 to a signed-out caller and to a tenant user (Management included)", async () => {
    const org = await createTestOrganization();
    const { user } = await createTestMembership(org.id, "MANAGEMENT");
    const tenant = await createSession(user.id);

    for (const path of ["organizations", "me"] as const) {
      holder.jar = jar({});
      expect((await getRoute(path)).status, `${path} signed out`).toBe(404);
      holder.jar = jar({ [SESSION_COOKIE_NAME]: tenant.token, [PLATFORM_SESSION_COOKIE_NAME]: tenant.token });
      expect((await getRoute(path)).status, `${path} as a tenant user`).toBe(404);
    }
    const prefs = await import("../src/app/api/platform/preferences/route");
    expect((await prefs.GET()).status).toBe(404);
  });

  it("let a platform admin in and show counts, with no customer data in the answer", async () => {
    const org = await createTestOrganization();
    await createCompany({ organizationId: org.id, name: "Hidden Customer Ltd" });
    const identity = await makePlatformIdentity();
    const s = await createPlatformSession(identity.id);
    holder.jar = jar({ [PLATFORM_SESSION_COOKIE_NAME]: s.token });

    const res = await getRoute("organizations");
    expect(res.status).toBe(200);
    const body = await res.json();
    const mine = body.organizations.find((o: { organizationId: string }) => o.organizationId === org.id);
    expect(mine).toMatchObject({ slug: org.slug, companyCount: 1 });
    expect(JSON.stringify(body)).not.toMatch(/Hidden Customer/);

    const me = await (await getRoute("me")).json();
    expect(me).toMatchObject({ id: identity.id, email: identity.email });
    expect(me.permissionKeys).toEqual([...PLATFORM_PERMISSION_KEYS].sort());
    expect(me.permissionKeys.every((k: string) => k.startsWith("platform."))).toBe(true);
  });

  it("answer 404 as soon as the admin is suspended or signed out", async () => {
    const identity = await makePlatformIdentity();
    const s = await createPlatformSession(identity.id);
    holder.jar = jar({ [PLATFORM_SESSION_COOKIE_NAME]: s.token });
    expect((await getRoute("me")).status).toBe(200);

    await adminDb.platformIdentity.update({ where: { id: identity.id }, data: { status: "SUSPENDED" } });
    expect((await getRoute("me")).status).toBe(404);
    await adminDb.platformIdentity.update({ where: { id: identity.id }, data: { status: "ACTIVE" } });
    expect((await getRoute("me")).status).toBe(200);
    await revokePlatformSession(s.token);
    expect((await getRoute("me")).status).toBe(404);
  });
});
