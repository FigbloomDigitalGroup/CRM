import { describe, expect, it } from "vitest";
import { effectivePermissionKeys } from "../src/auth/permissions";
import { ROLES, ROLE_PERMISSIONS } from "../prisma/seedData";
import { DEV_USERS } from "../prisma/devSeed";

/** UC-C7 (FIG-1791) and UC-R10 (FIG-1781): the Marketing role, the Social keys, and the Sales draft Invoices page keys. Pure, no database. */
const keys = (roleKey: string, release: "v1" | "v1.1" | "v2" = "v2") =>
  effectivePermissionKeys({ roleKey, catalogueKeys: ROLE_PERMISSIONS[roleKey] ?? [], config: { release, toggles: {} } });

describe("Marketing role", () => {
  it("is a platform role with a dev account", () => {
    expect(ROLES.map((r) => r.key)).toContain("MARKETING");
    expect(DEV_USERS.find((u) => u.roleKey === "MARKETING")?.email).toBe("dev.marketing@figbloom.local");
  });

  it("holds the Social keys, sources its own leads and never sees deal values, payments or invoices", () => {
    const k = keys("MARKETING");
    for (const key of ["social.view", "social.publish", "leads.view.own", "leads.create", "contacts.view", "companies.view", "communications.create", "tasks.view.own", "reporting.view.own"]) {
      expect(k, key).toContain(key);
    }
    for (const key of ["deals.view.all", "deals.view.own", "deals.view.value", "deals.margin", "finance.view.payments", "finance.manage.payments", "invoices.view", "invoices.create", "payments.record", "quotes.view", "quotes.create"]) {
      expect(k, key).not.toContain(key);
    }
  });

  it("Management has both Social keys; Sales, Delivery, Finance and Restricted Technical have neither", () => {
    expect(keys("MANAGEMENT")).toEqual(expect.arrayContaining(["social.view", "social.publish"]));
    for (const role of ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]) {
      expect(keys(role).filter((x) => x.startsWith("social."))).toEqual([]);
    }
  });
});

describe("Sales prepares quotes and draft invoices", () => {
  it("holds quotes.view, quotes.create, invoices.view and invoices.create, and still no payment keys", () => {
    const k = keys("SALES");
    expect(k).toEqual(expect.arrayContaining(["quotes.view", "quotes.create", "invoices.view", "invoices.create"]));
    for (const key of ["finance.view.payments", "finance.manage.payments", "payments.record", "invoices.edit", "invoices.send", "finance.export"]) {
      expect(k, key).not.toContain(key);
    }
  });
});
