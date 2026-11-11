import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";

/**
 * FIG-1565: migration 20261120090000_remove_customer_support stopped on a database where the dev Customer Support user still had records
 * (a task assigned to them: "update or delete on table memberships violates foreign key constraint"). The migration now clears or hands over
 * every record that points at a Customer Support membership before it removes it. These tests run the migration file itself against a
 * database that holds exactly that situation, so the fix cannot quietly regress.
 */
const SQL = readFileSync("prisma/migrations/20261120090000_remove_customer_support/migration.sql", "utf8");

async function runMigrationSql(): Promise<void> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(SQL); // one simple-protocol call, so the temporary table and the DO block run in one transaction
  } finally {
    await client.end();
  }
}

async function supportRoleId(): Promise<string> {
  const role = await adminDb.role.upsert({
    where: { key: "CUSTOMER_SUPPORT" },
    update: {},
    create: { key: "CUSTOMER_SUPPORT", name: "Customer Support" },
  });
  return role.id;
}

async function supportMember(organizationId: string, email: string) {
  const roleId = await supportRoleId();
  const user = await adminDb.user.create({ data: { email, name: "Dev Support" } });
  const membership = await adminDb.membership.create({ data: { organizationId, userId: user.id, roleId, joinedAt: new Date() } });
  return { user, membership };
}

describe("migration 20261120090000_remove_customer_support (FIG-1565)", () => {
  afterAll(async () => {
    // A failing run must not leave the role behind for other test files.
    const role = await adminDb.role.findUnique({ where: { key: "CUSTOMER_SUPPORT" } });
    if (role) {
      await adminDb.membership.deleteMany({ where: { roleId: role.id } });
      await adminDb.role.delete({ where: { id: role.id } }).catch(() => undefined);
    }
  });

  it("removes the Customer Support dev user even when tasks and records are tied to them", async () => {
    const org = await createTestOrganization("Mig Support");
    const manager = await createTestMembership(org.id, "MANAGEMENT", "mig.manager");
    const support = await supportMember(org.id, `support.${randomUUID().slice(0, 8)}@example.test`);

    const task = await adminDb.task.create({
      data: { organizationId: org.id, title: "Call back", assigneeMembershipId: support.membership.id, createdByMembershipId: support.membership.id },
    });
    const company = await adminDb.company.create({
      data: { organizationId: org.id, name: `Acme ${randomUUID().slice(0, 4)}`, ownerMembershipId: support.membership.id },
    });

    await runMigrationSql();

    // The required assignee and creator are handed to the organisation's Management member; the optional owner is cleared.
    const taskAfter = await adminDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(taskAfter.assigneeMembershipId).toBe(manager.membership.id);
    expect(taskAfter.createdByMembershipId).toBe(manager.membership.id);
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: company.id } })).ownerMembershipId).toBeNull();

    // The account, its membership and the role are gone; the organisation and its other members are untouched.
    expect(await adminDb.membership.findUnique({ where: { id: support.membership.id } })).toBeNull();
    expect(await adminDb.user.findUnique({ where: { id: support.user.id } })).toBeNull();
    expect(await adminDb.role.findUnique({ where: { key: "CUSTOMER_SUPPORT" } })).toBeNull();
    expect(await adminDb.membership.findUnique({ where: { id: manager.membership.id } })).not.toBeNull();
  });

  it("is safe to run again once the role is gone", async () => {
    await runMigrationSql();
    expect(await adminDb.role.findUnique({ where: { key: "CUSTOMER_SUPPORT" } })).toBeNull();
  });

  it("still refuses to run when a real account holds the role", async () => {
    const org = await createTestOrganization("Mig Support Real");
    const real = await supportMember(org.id, `real.${randomUUID().slice(0, 8)}@acme-clients.example`);
    await expect(runMigrationSql()).rejects.toThrow(/real account still holds the Customer Support role/);
    // Nothing was removed.
    expect(await adminDb.membership.findUnique({ where: { id: real.membership.id } })).not.toBeNull();
    await adminDb.membership.delete({ where: { id: real.membership.id } });
    await adminDb.user.delete({ where: { id: real.user.id } });
    await adminDb.role.delete({ where: { key: "CUSTOMER_SUPPORT" } });
  });
});
