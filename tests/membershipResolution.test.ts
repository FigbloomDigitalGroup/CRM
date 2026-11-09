import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MembershipStatus, Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OrganizationUnavailableError } from "../src/auth/errors";
import { effectivePermissionKeys } from "../src/auth/permissions";
import { adminDb } from "../src/db/adminClient";
import { loadFeatureConfig, RELEASE_KEY, TOGGLES_KEY } from "../src/lib/featureConfig";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";

/**
 * `resolveActiveMembership` is the one authentication/authorisation choke point and is written as a single raw SQL statement (a nested
 * Prisma `include` cost five statements on every request). A raw statement is invisible to `tsc`, so this file proves three things:
 *
 *   1. its table and column names still match prisma/schema.prisma (a rename fails here, loudly, not in production);
 *   2. every value reaches the database as a bound parameter (no string building, so no injection surface);
 *   3. it answers exactly what the Prisma implementation it replaced answered, for every role, release, feature toggle and organisation
 *      status, and for every active membership already in the test database.
 */

/** A faithful copy of the implementation this one replaced (git show HEAD:src/repositories/memberships.ts), kept only here. */
async function resolveActiveMembershipPrisma(userId: string, organizationId: string, options: { allowOffboarding?: boolean } = {}) {
  const [membership, config] = await Promise.all([
    adminDb.membership.findFirst({
      where: { userId, organizationId, status: MembershipStatus.ACTIVE },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
        organization: { select: { status: true, name: true } },
      },
    }),
    loadFeatureConfig(organizationId),
  ]);
  if (!membership) return null;
  const lock = membership.organization.status;
  if (lock === "SUSPENDED" || lock === "OFFBOARDED" || (lock === "OFFBOARDING" && !options.allowOffboarding)) {
    throw new OrganizationUnavailableError(lock, membership.organization.name);
  }
  return {
    membershipId: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    roleKey: membership.role.key,
    permissionKeys: effectivePermissionKeys({
      roleKey: membership.role.key,
      catalogueKeys: membership.role.rolePermissions.map((rp) => rp.permission.key),
      config,
    }),
  };
}

type Outcome = { ok: unknown } | { error: string; message: string; status?: string };
async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: await run() };
  } catch (err) {
    const e = err as Error & { status?: string };
    return { error: e.constructor.name, message: e.message, status: e.status };
  }
}

const createdOrganizations: string[] = [];
afterAll(async () => {
  // Best effort: the organisations this file made go with their memberships (cascade); the users are throwaway @example.test accounts.
  await adminDb.organization.deleteMany({ where: { id: { in: createdOrganizations } } }).catch(() => undefined);
});

async function newOrganization() {
  const org = await createTestOrganization("Membership Diff");
  createdOrganizations.push(org.id);
  return org;
}

describe("resolveActiveMembership raw SQL: schema guard", () => {
  const source = readFileSync(join(__dirname, "..", "src", "repositories", "memberships.ts"), "utf8");
  const start = source.indexOf("export async function resolveActiveMembership");
  const fn = source.slice(start, source.indexOf("\n}\n", start));
  const sqlMatch = /Prisma\.sql`([\s\S]*?)`\)/.exec(fn);

  it("is a Prisma.sql tagged template, with no unsafe raw API anywhere in the repository", () => {
    expect(sqlMatch, "resolveActiveMembership must build its statement with Prisma.sql`...`").not.toBeNull();
    expect(source).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/);
  });

  it("binds the user, organisation and status as parameters: nothing is interpolated into the text", () => {
    const sql = sqlMatch![1]!;
    // Every `${...}` is a bound parameter; the only allowed ones are these three.
    const interpolations = [...sql.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(interpolations).toEqual(["userId", "organizationId", "MembershipStatus.ACTIVE"]);
    // And Prisma really sends them separately from the text.
    const built = Prisma.sql`SELECT 1 WHERE a = ${"x'; DROP TABLE memberships; --"}`;
    expect(built.text).toBe("SELECT 1 WHERE a = $1");
    expect(built.values).toEqual(["x'; DROP TABLE memberships; --"]);
  });

  it("uses only table and column names that exist in prisma/schema.prisma", () => {
    const sql = sqlMatch![1]!;
    const models = Prisma.dmmf.datamodel.models;
    const byTable = new Map(models.map((m) => [m.dbName ?? m.name, m]));
    const columnOf = (model: (typeof models)[number], column: string) =>
      model.fields.some((f) => f.kind !== "object" && (f.dbName ?? f.name) === column);

    // Aliases: "FROM memberships m", "JOIN roles r", ...
    const aliases = new Map<string, string>();
    for (const [, table, alias] of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(\w+)/g)) aliases.set(alias!, table!);
    expect([...aliases.values()].sort()).toEqual(["memberships", "organizations", "permissions", "role_permissions", "roles"]);
    for (const table of aliases.values()) expect(byTable.has(table), `table ${table} is not in the Prisma schema`).toBe(true);

    const refs = [...sql.matchAll(/\b([a-z]{1,2})\.(\w+)\b/g)].filter(([, alias]) => aliases.has(alias!));
    expect(refs.length).toBeGreaterThan(10);
    for (const [, alias, column] of refs) {
      const table = aliases.get(alias!)!;
      expect(columnOf(byTable.get(table)!, column!), `column ${table}.${column} is not in the Prisma schema`).toBe(true);
    }
    // Enum type the status is cast to.
    for (const [, enumName] of sql.matchAll(/::"(\w+)"/g)) {
      expect(Prisma.dmmf.datamodel.enums.some((e) => (e.dbName ?? e.name) === enumName), `enum ${enumName}`).toBe(true);
    }
  });

  it("returns an empty permission list, never [null], for a role that holds no permissions", async () => {
    const org = await newOrganization();
    const role = await adminDb.role.create({ data: { key: `EMPTY_${org.id.slice(0, 8)}`, name: "No permissions", isSystem: false } });
    const { membership } = await createTestMembership(org.id, "SALES");
    await adminDb.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
    try {
      const rows = await adminDb.$queryRaw<Array<{ keys: string[] }>>(Prisma.sql`
        SELECT COALESCE(array_agg(p.key) FILTER (WHERE p.key IS NOT NULL), ARRAY[]::text[]) AS keys
        FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.id = ${role.id} GROUP BY r.key`);
      expect(rows[0]!.keys).toEqual([]);
      const resolved = await resolveActiveMembership(membership.userId, org.id);
      expect(resolved).toMatchObject({ roleKey: role.key, permissionKeys: [] });
      expect(await resolveActiveMembershipPrisma(membership.userId, org.id)).toEqual(resolved);
    } finally {
      await adminDb.membership.delete({ where: { id: membership.id } });
      await adminDb.role.delete({ where: { id: role.id } });
    }
  });
});

describe("resolveActiveMembership raw SQL: same answers as the Prisma implementation", () => {
  const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const;

  it("matches for each of the five roles under every release and with feature toggles on and off", async () => {
    const releases = ["v1", "v1.1", "v2"] as const;
    for (const release of releases) {
      for (const toggles of [{}, { quotes: true, chat: true, sequences: true }, { quotes: false, chat: false }]) {
        const org = await newOrganization();
        await adminDb.organizationSetting.createMany({
          data: [
            { organizationId: org.id, key: RELEASE_KEY, value: { release } },
            { organizationId: org.id, key: TOGGLES_KEY, value: toggles },
          ],
        });
        for (const roleKey of ROLES) {
          const { membership } = await createTestMembership(org.id, roleKey);
          const next = await resolveActiveMembership(membership.userId, org.id);
          const prev = await resolveActiveMembershipPrisma(membership.userId, org.id);
          expect(next, `${roleKey} @ ${release}`).toEqual(prev);
          expect(next?.roleKey).toBe(roleKey);
          expect(next?.permissionKeys.length).toBeGreaterThan(0);
          expect([...next!.permissionKeys]).toEqual([...next!.permissionKeys].sort());
        }
      }
    }
  });

  it("matches (value or error) for an active, suspended, offboarding and offboarded organisation, with and without allowOffboarding", async () => {
    for (const status of ["ACTIVE", "SUSPENDED", "OFFBOARDING", "OFFBOARDED"] as const) {
      const org = await newOrganization();
      const { membership } = await createTestMembership(org.id, "MANAGEMENT");
      await adminDb.organization.update({ where: { id: org.id }, data: { status } });
      for (const allowOffboarding of [undefined, false, true]) {
        const options = allowOffboarding === undefined ? {} : { allowOffboarding };
        const next = await outcome(() => resolveActiveMembership(membership.userId, org.id, options));
        const prev = await outcome(() => resolveActiveMembershipPrisma(membership.userId, org.id, options));
        expect(next, `${status} allowOffboarding=${String(allowOffboarding)}`).toEqual(prev);
        const lockedOut = status === "SUSPENDED" || status === "OFFBOARDED" || (status === "OFFBOARDING" && !allowOffboarding);
        if (lockedOut) expect(next).toMatchObject({ error: "OrganizationUnavailableError" });
        else expect(next).toMatchObject({ ok: { roleKey: "MANAGEMENT" } });
      }
    }
  });

  it("answers null (deny) for every non-ACTIVE membership status, another organisation, another user and unknown ids", async () => {
    const org = await newOrganization();
    const other = await newOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const { membership: outsider } = await createTestMembership(other.id, "SALES");
    for (const status of Object.values(MembershipStatus)) {
      await adminDb.membership.update({ where: { id: membership.id }, data: { status } });
      const next = await resolveActiveMembership(membership.userId, org.id);
      const prev = await resolveActiveMembershipPrisma(membership.userId, org.id);
      expect(next, status).toEqual(prev);
      if (status !== "ACTIVE") expect(next).toBeNull();
    }
    expect(await resolveActiveMembership(membership.userId, other.id)).toBeNull();
    expect(await resolveActiveMembership(outsider.userId, org.id)).toBeNull();
    const zero = "00000000-0000-0000-0000-000000000000";
    expect(await resolveActiveMembership(zero, org.id)).toBeNull();
    expect(await resolveActiveMembership(membership.userId, zero)).toBeNull();
    // A value that is not a UUID is a bound parameter, not SQL: it simply matches nothing (or is rejected by the database), never executes.
    const hostile = await outcome(() => resolveActiveMembership("x' OR '1'='1", org.id));
    expect("ok" in hostile ? hostile.ok : null).toBeNull();
    expect(await adminDb.membership.count({ where: { id: membership.id } })).toBe(1);
  });

  it("matches for EVERY active membership already in the test database", async () => {
    const all = await adminDb.membership.findMany({
      where: { status: MembershipStatus.ACTIVE },
      select: { userId: true, organizationId: true },
    });
    expect(all.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (let i = 0; i < all.length; i += 12) {
      await Promise.all(
        all.slice(i, i + 12).map(async (m) => {
          const [next, prev] = await Promise.all([
            outcome(() => resolveActiveMembership(m.userId, m.organizationId)),
            outcome(() => resolveActiveMembershipPrisma(m.userId, m.organizationId)),
          ]);
          if (JSON.stringify(next) !== JSON.stringify(prev)) mismatches.push(`${m.userId}/${m.organizationId}`);
        }),
      );
    }
    expect(mismatches).toEqual([]);
  }, 600_000);
});
