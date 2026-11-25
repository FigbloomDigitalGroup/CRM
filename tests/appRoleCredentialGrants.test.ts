import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { listCalendarActivities } from "../src/repositories/activities";
import { listTaskGroup, listTasks } from "../src/repositories/tasks";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import {
  APP_ROLE_NO_ACCESS_CREDENTIAL_TABLES,
  APP_ROLE_USER_READABLE_COLUMNS,
  USER_CREDENTIAL_COLUMNS,
} from "../scripts/lib/appRoleCredentialGrants";
import { evaluate, type CredentialGrantState } from "../scripts/lib/migrationVerify";
import { createTestMembership, createTestOrganization, createTestUser } from "./helpers/fixtures";

/**
 * UC-F3 (Security S-4, FIG-1767): the tenant-facing role `figbloom_app` must not be able to read password hashes, sign-in lockout state or
 * password-reset tokens, even from code that runs inside an organisation context. Authentication runs on the owner connection (`adminDb`).
 * tests/globalSetup.ts runs `db:grant-role` before this file, so these checks also prove the order inside that script (the blanket grant
 * comes first, the restrictions after it).
 */

describe("verify:migration credential check (UC-F3, S-4)", () => {
  const none: CredentialGrantState = { credentialColumnsReadable: [], safeColumnsMissing: [], usersWritePrivileges: [], closedTablePrivileges: [], unclassifiedColumns: [] };
  const base = { tables: [], appRoleExists: true };
  const find = (g?: CredentialGrantState) => evaluate({ ...base, credentialGrants: g }).checks.find((c) => c.name.startsWith("App role cannot read credentials"));

  it("passes when nothing is readable, users is read-only and every column is classified", () => {
    expect(find(none)?.ok).toBe(true);
  });

  it("fails, naming the problem, when the password hash, a write privilege, a reset-token privilege, a missing safe column or an unclassified column shows up", () => {
    expect(find({ ...none, credentialColumnsReadable: ["password_hash"] })?.detail).toContain("app role can read users.password_hash");
    expect(find({ ...none, usersWritePrivileges: ["UPDATE"] })?.ok).toBe(false);
    expect(find({ ...none, closedTablePrivileges: ["password_reset_tokens: SELECT"] })?.detail).toContain("password_reset_tokens: SELECT");
    expect(find({ ...none, safeColumnsMissing: ["email"] })?.ok).toBe(false);
    expect(find({ ...none, unclassifiedColumns: ["new_col"] })?.detail).toContain("users.new_col is not classified");
  });

  it("adds no check when the app role does not exist (the existing role check already fails)", () => {
    expect(find(undefined)).toBeUndefined();
  });
});

const app = () => getUnscopedAppClientForTests();
const denied = /permission denied/i;

describe("figbloom_app credential grants (UC-F3, S-4)", () => {
  it("every column of users is classified as readable or credential, so a new column cannot slip in unnoticed", async () => {
    const cols = await adminDb.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`;
    const actual = cols.map((c) => c.column_name).sort();
    const classified = [...APP_ROLE_USER_READABLE_COLUMNS, ...USER_CREDENTIAL_COLUMNS].sort();
    expect(classified).toEqual(actual);
    expect(APP_ROLE_USER_READABLE_COLUMNS.filter((c) => (USER_CREDENTIAL_COLUMNS as readonly string[]).includes(c))).toEqual([]);
  });

  it("column privileges: readable columns yes, credential columns no, no table-wide SELECT, no write privilege on users", async () => {
    for (const col of APP_ROLE_USER_READABLE_COLUMNS) {
      const [r] = await adminDb.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT has_column_privilege('figbloom_app', 'public.users', '${col}', 'SELECT') AS ok`);
      expect(r.ok, `SELECT on users.${col}`).toBe(true);
    }
    for (const col of USER_CREDENTIAL_COLUMNS) {
      const [r] = await adminDb.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT has_column_privilege('figbloom_app', 'public.users', '${col}', 'SELECT') AS ok`);
      expect(r.ok, `SELECT on users.${col}`).toBe(false);
    }
    const [t] = await adminDb.$queryRaw<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }[]>`
      SELECT has_table_privilege('figbloom_app', 'public.users', 'SELECT') AS sel,
             has_table_privilege('figbloom_app', 'public.users', 'INSERT') AS ins,
             has_table_privilege('figbloom_app', 'public.users', 'UPDATE') AS upd,
             has_table_privilege('figbloom_app', 'public.users', 'DELETE') AS del`;
    expect(t).toEqual({ sel: false, ins: false, upd: false, del: false });
    for (const table of APP_ROLE_NO_ACCESS_CREDENTIAL_TABLES) {
      const [p] = await adminDb.$queryRawUnsafe<{ any: boolean }[]>(
        `SELECT (has_table_privilege('figbloom_app', 'public.${table}', 'SELECT') OR has_table_privilege('figbloom_app', 'public.${table}', 'INSERT')
              OR has_table_privilege('figbloom_app', 'public.${table}', 'UPDATE') OR has_table_privilege('figbloom_app', 'public.${table}', 'DELETE')) AS any`,
      );
      expect(p.any, `any privilege on ${table}`).toBe(false);
    }
  });

  it("the app role cannot select password_hash, and cannot read any credential column or SELECT * from users", async () => {
    await createTestUser("s4.hash");
    await expect(app().$queryRawUnsafe(`SELECT password_hash FROM users LIMIT 1`)).rejects.toThrow(denied);
    for (const col of USER_CREDENTIAL_COLUMNS) {
      await expect(app().$queryRawUnsafe(`SELECT ${col} FROM users LIMIT 1`), col).rejects.toThrow(denied);
    }
    await expect(app().$queryRawUnsafe(`SELECT * FROM users LIMIT 1`)).rejects.toThrow(denied);
  });

  it("the app role cannot read, count or write password_reset_tokens", async () => {
    await expect(app().$queryRawUnsafe(`SELECT * FROM password_reset_tokens LIMIT 1`)).rejects.toThrow(denied);
    await expect(app().$queryRawUnsafe(`SELECT token_hash FROM password_reset_tokens LIMIT 1`)).rejects.toThrow(denied);
    await expect(app().$queryRawUnsafe(`SELECT count(*) FROM password_reset_tokens`)).rejects.toThrow(denied);
    await expect(app().$executeRawUnsafe(`DELETE FROM password_reset_tokens`)).rejects.toThrow(denied);
  });

  it("the app role cannot insert, update or delete users", async () => {
    const user = await createTestUser("s4.write");
    await expect(app().$executeRawUnsafe(`UPDATE users SET name = 'x' WHERE id = '${user.id}'`)).rejects.toThrow(denied);
    await expect(app().$executeRawUnsafe(`DELETE FROM users WHERE id = '${user.id}'`)).rejects.toThrow(denied);
    await expect(
      app().$executeRawUnsafe(`INSERT INTO users (id, email, name, updated_at) VALUES ('s4-${user.id}', 's4-${user.id}@example.test', 'x', now())`),
    ).rejects.toThrow(denied);
  });

  it("the non-secret columns stay readable, in the exact shape the app code uses (a member's name, email and time zone)", async () => {
    const org = await createTestOrganization("S4 Org");
    const { user, membership } = await createTestMembership(org.id, "SALES", "s4.read");
    const rows = await app().$queryRawUnsafe<{ id: string; email: string; name: string }[]>(
      `SELECT ${APP_ROLE_USER_READABLE_COLUMNS.join(", ")} FROM users WHERE id = '${user.id}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(user.email);

    const viaMembership = await withOrgContext(org.id, (tx) =>
      tx.membership.findMany({ where: { organizationId: org.id, id: membership.id }, select: { id: true, user: { select: { name: true, email: true, timeZone: true } } } }),
    );
    expect(viaMembership[0].user.email).toBe(user.email);
    // Joined through memberships, as teamService does.
    const joined = await withOrgContext(org.id, (tx) =>
      tx.$queryRaw<{ name: string }[]>`SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ${org.id}`,
    );
    expect(joined.length).toBe(1);
  });

  it("loading the whole user row through the app role fails: a relation must select the safe fields only", async () => {
    const org = await createTestOrganization("S4 Whole Row");
    const { membership } = await createTestMembership(org.id, "SALES", "s4.whole");
    await expect(withOrgContext(org.id, (tx) => tx.membership.findMany({ where: { id: membership.id }, include: { user: true } }))).rejects.toThrow(denied);
    await expect(withOrgContext(org.id, (tx) => tx.user.findFirst())).rejects.toThrow(denied);
  });

  it("the app-role queries that load an assignee or author name still work: task list, grouped task list and calendar activity feed", async () => {
    const org = await createTestOrganization("S4 Names");
    const { user, membership } = await createTestMembership(org.id, "SALES", "s4.names");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    await adminDb.task.create({
      data: { organizationId: org.id, title: "S4 task", assigneeMembershipId: membership.id, createdByMembershipId: membership.id, dueAt: new Date(start.getTime() + 3_600_000) },
    });
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "S4 Co" } });
    await adminDb.activity.create({
      data: { organizationId: org.id, type: "CALL", subject: "S4 call", companyId: company.id, authorMembershipId: membership.id, occurredAt: new Date(start.getTime() + 7_200_000) },
    });

    const tasks = await listTasks(org.id, {});
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assignee.user.name).toBe(user.name);
    expect(Object.keys(tasks[0].assignee.user)).toEqual(["name"]);

    const bounds = { todayStart: start, tomorrowStart: new Date(start.getTime() + 86_400_000), nextWeekStart: new Date(start.getTime() + 7 * 86_400_000) };
    const today = await listTaskGroup(org.id, {}, "TODAY", bounds, { skip: 0, take: 10 });
    expect(today).toHaveLength(1);
    expect(today[0].assignee.user.name).toBe(user.name);

    const calls = await listCalendarActivities(org.id, { from: start, to: bounds.tomorrowStart, take: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0].author.user.name).toBe(user.name);
    expect(Object.keys(calls[0].author.user)).toEqual(["name"]);
  });

  it("the owner connection is unaffected: authentication can still read and write credentials and reset tokens", async () => {
    const user = await createTestUser("s4.owner");
    await adminDb.user.update({ where: { id: user.id }, data: { passwordHash: "h", failedSignInCount: 2, lockedUntil: new Date(Date.now() + 60_000) } });
    const again = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(again.passwordHash).toBe("h");
    expect(again.failedSignInCount).toBe(2);
    const token = await adminDb.passwordResetToken.create({ data: { userId: user.id, tokenHash: `s4-${user.id}`, expiresAt: new Date(Date.now() + 60_000) } });
    expect((await adminDb.passwordResetToken.findUniqueOrThrow({ where: { id: token.id } })).userId).toBe(user.id);
  });

  it("the platform role has no privilege on users or password_reset_tokens (unchanged)", async () => {
    const [r] = await adminDb.$queryRaw<{ users: boolean; tokens: boolean }[]>`
      SELECT has_table_privilege('figbloom_platform', 'public.users', 'SELECT') AS users,
             has_table_privilege('figbloom_platform', 'public.password_reset_tokens', 'SELECT') AS tokens`;
    expect(r).toEqual({ users: false, tokens: false });
  });

  it("re-running db:grant-role keeps the restrictions (the blanket grant must not win on a second run)", async () => {
    execSync("npx tsx scripts/db-admin.ts grant-role", { stdio: "pipe", env: { ...process.env } });
    const [r] = await adminDb.$queryRaw<{ hash: boolean; email: boolean; tokens: boolean }[]>`
      SELECT has_column_privilege('figbloom_app', 'public.users', 'password_hash', 'SELECT') AS hash,
             has_column_privilege('figbloom_app', 'public.users', 'email', 'SELECT') AS email,
             has_table_privilege('figbloom_app', 'public.password_reset_tokens', 'SELECT') AS tokens`;
    expect(r).toEqual({ hash: false, email: true, tokens: false });
  });
});
