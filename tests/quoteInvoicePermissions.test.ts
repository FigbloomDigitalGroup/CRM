import { describe, expect, it } from "vitest";
import baseline from "./fixtures/effectiveKeysBaseline.json";
import type { AuthContext } from "../src/auth/context";
import { DEPARTURES, DEPARTURES_MASTER_TOGGLE, effectivePermissionKeys } from "../src/auth/permissions";
import { adminDb } from "../src/db/adminClient";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { PERMISSIONS, PERMISSION_IMPLICATIONS, PERMISSION_MIN_RELEASE, ROLES, ROLE_PERMISSIONS, UC_R1_NEW_KEYS } from "../prisma/seedData";
import { seedRolesAndPermissions } from "../prisma/seedReference";
import { grantableKeys, validatePermissionKeys } from "../src/lib/roleLimits";
import { setOrganizationRelease } from "../src/services/featureService";
import { createRole, getRole, listRoles } from "../src/services/roleEditorService";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

/**
 * UC-R1 (FIG-1775): the quote and invoice permissions are split without changing any role's access.
 *
 * The "before" side is tests/fixtures/effectiveKeysBaseline.json, generated from the untouched baseline commit 9bbc385 (its own
 * seedData.ts, permissions.ts and featureFlags.ts, run for every platform role at releases v1, v1.1 and v2, with the departure
 * flags at their defaults, with the umbrella flag off, and with every departure off, plus a sample custom role). This test
 * compares today's effective keys with it: apart from the ten new keys, every set must be IDENTICAL, and the new keys each role
 * gains must be exactly the ones the compatibility rule gives it. Anything else (a lost key, an extra key, a role that gains a
 * key it should not) fails here.
 */

type Label = keyof typeof baseline.effective;
type Release = "v1" | "v1.1" | "v2";

const NEW = new Set(UC_R1_NEW_KEYS);
const QUOTE_KEYS = ["quotes.edit", "quotes.send", "quotes.view"];
const FINANCE_KEYS = ["finance.export", "finance.reports.view", "invoices.create", "invoices.edit", "invoices.send", "invoices.view", "payments.record"];

/** The new keys each role may gain, written by hand from the issue's compatibility rule (not derived from the code under test). */
function expectedAdditions(roleKey: string, release: Release): string[] {
  const quotes = release === "v1" ? [] : QUOTE_KEYS; // the quote keys follow quotes.create, which is V1.1
  if (roleKey === "MANAGEMENT") return [...quotes, ...FINANCE_KEYS].sort();
  if (roleKey === "SALES") return [...quotes].sort(); // quotes.create implies view, edit and send
  if (roleKey === "FINANCE") return [...(release === "v1" ? [] : ["quotes.view"]), ...FINANCE_KEYS].sort(); // Finance gains quotes.view; the rest mirror finance.*.payments
  return []; // DELIVERY and RESTRICTED_TECHNICAL hold none of the source keys
}

function configFor(label: string): { release: Release; toggles: Record<string, boolean> } {
  const [release, set] = label.split("|") as [Release, string];
  const toggles: Record<string, boolean> =
    set === "masterOff" ? { [DEPARTURES_MASTER_TOGGLE]: false } : set === "allDeparturesOff" ? Object.fromEntries(DEPARTURES.map((d) => [d.toggle, false])) : {};
  return { release, toggles };
}

const platformLabels = Object.keys(baseline.effective).filter((l) => !l.startsWith("custom|")) as Label[];

describe("platform roles keep exactly their effective access (snapshot against the baseline commit)", () => {
  it("has a baseline for every role, release and departure setting it compares", () => {
    expect(platformLabels.length).toBe(9);
    expect(Object.keys(baseline.effective["v2|defaults"]).sort()).toEqual(ROLES.map((r) => r.key).sort());
  });

  for (const label of platformLabels) {
    for (const role of ROLES) {
      it(`${role.key} at ${label}: nothing lost, nothing else gained, new keys exactly as the compatibility rule says`, () => {
        const { release, toggles } = configFor(label);
        const now = effectivePermissionKeys({ roleKey: role.key, catalogueKeys: ROLE_PERMISSIONS[role.key] ?? [], config: { release, toggles } });
        const before = (baseline.effective[label] as Record<string, string[]>)[role.key]!;
        expect(now.filter((k) => !NEW.has(k)), "keys other than the ten new ones must be identical to the baseline").toEqual(before);
        expect(now.filter((k) => NEW.has(k)).sort(), "the new keys this role gains").toEqual(expectedAdditions(role.key, release));
      });
    }
  }

  it("is deliberate about the one addition that is not implied: Finance gets quotes.view", () => {
    const withoutNew = ROLE_PERMISSIONS.FINANCE!.filter((k) => !NEW.has(k));
    const onlyImplied = effectivePermissionKeys({ roleKey: "FINANCE", catalogueKeys: withoutNew, config: { release: "v2", toggles: {} } });
    const seeded = effectivePermissionKeys({ roleKey: "FINANCE", catalogueKeys: ROLE_PERMISSIONS.FINANCE!, config: { release: "v2", toggles: {} } });
    expect(seeded.filter((k) => !onlyImplied.includes(k))).toEqual(["quotes.view"]);
    // and every other new key a platform role is seeded with is already implied, so the seeded rows are redundant, never wider
    for (const role of ROLES) {
      const stripped = effectivePermissionKeys({ roleKey: role.key, catalogueKeys: (ROLE_PERMISSIONS[role.key] ?? []).filter((k) => !NEW.has(k)), config: { release: "v2", toggles: {} } });
      const full = effectivePermissionKeys({ roleKey: role.key, catalogueKeys: ROLE_PERMISSIONS[role.key] ?? [], config: { release: "v2", toggles: {} } });
      expect(full.filter((k) => !stripped.includes(k)), role.key).toEqual(role.key === "FINANCE" ? ["quotes.view"] : []);
    }
  });
});

describe("custom roles keep their effective access (implication, not a data change)", () => {
  const custom = baseline.customCatalogue; // quotes.create, quotes.approve, contacts.view, deals.view.own, deals.create, chat.view

  it("at V1.1 a custom role holding quotes.create gains exactly quotes.view, edit and send; nothing else changes", () => {
    const now = effectivePermissionKeys({ roleKey: "CUSTOM", catalogueKeys: custom, config: { release: "v1.1", toggles: {} }, custom: true });
    const before = baseline.effective["custom|v1.1|defaults"]!.sample!;
    expect(now.filter((k) => !NEW.has(k))).toEqual(before);
    expect(now.filter((k) => NEW.has(k)).sort()).toEqual(QUOTE_KEYS);
  });

  it("at V1 a custom role gains nothing (the quote keys are V1.1)", () => {
    const now = effectivePermissionKeys({ roleKey: "CUSTOM", catalogueKeys: custom, config: { release: "v1", toggles: {} }, custom: true });
    expect(now).toEqual(baseline.effective["custom|v1|defaults"]!.sample);
  });

  it("an approver without quotes.create can still read quotes (quotes.approve implies quotes.view only)", () => {
    const now = effectivePermissionKeys({ roleKey: "CUSTOM", catalogueKeys: ["quotes.approve"], config: { release: "v1.1", toggles: {} }, custom: true });
    expect(now).toEqual(["quotes.approve", "quotes.view"]);
  });

  it("a custom role with no quote or payment key gains nothing", () => {
    const keys = ["contacts.view", "deals.view.own", "deals.create"];
    expect(effectivePermissionKeys({ roleKey: "CUSTOM", catalogueKeys: keys, config: { release: "v2", toggles: {} }, custom: true })).toEqual([...keys].sort());
  });

  it("the payment keys imply the invoice keys, but they can never be on a custom role (rule 7)", () => {
    for (const k of ["finance.view.payments", "finance.manage.payments", "payments.record"]) {
      expect(validatePermissionKeys([k]).map((i) => i.code), k).toEqual(["RESERVED_PERMISSION"]);
      expect(grantableKeys()).not.toContain(k);
    }
  });
});

describe("the catalogue and the compatibility table", () => {
  it("adds exactly the ten keys of the issue, once each, in the existing areas", () => {
    expect([...UC_R1_NEW_KEYS].sort()).toEqual(
      ["finance.export", "finance.reports.view", "invoices.create", "invoices.edit", "invoices.send", "invoices.view", "payments.record", "quotes.edit", "quotes.send", "quotes.view"],
    );
    for (const key of UC_R1_NEW_KEYS) {
      expect(PERMISSIONS.filter((p) => p.key === key), key).toHaveLength(1);
      expect(["Quotes", "Finance"]).toContain(PERMISSIONS.find((p) => p.key === key)!.area);
    }
    for (const key of ["quotes.create", "quotes.approve", "finance.view.payments", "finance.manage.payments", "export.bulk"]) {
      expect(PERMISSIONS.some((p) => p.key === key), `existing key ${key} stays`).toBe(true);
    }
  });

  it("has implications that name real keys, that are one level deep, and that match the issue", () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    for (const [from, to] of Object.entries(PERMISSION_IMPLICATIONS)) {
      expect(known.has(from), from).toBe(true);
      for (const key of to) {
        expect(known.has(key), `${from} -> ${key}`).toBe(true);
        expect(PERMISSION_IMPLICATIONS[key], `${key} must not imply anything (one level only)`).toBeUndefined();
      }
    }
    expect(PERMISSION_IMPLICATIONS["quotes.create"]).toEqual(["quotes.view", "quotes.edit", "quotes.send"]);
    expect([...PERMISSION_IMPLICATIONS["finance.manage.payments"]!].sort()).toEqual(["finance.export", "invoices.create", "invoices.edit", "invoices.send", "payments.record"]);
    expect([...PERMISSION_IMPLICATIONS["finance.view.payments"]!].sort()).toEqual(["finance.reports.view", "invoices.view"]);
  });

  it("releases: the quote keys follow quotes.create (V1.1); the invoice and finance keys are V1; bulk export still needs export.bulk", () => {
    for (const k of QUOTE_KEYS) expect(PERMISSION_MIN_RELEASE[k], k).toBe("v1.1");
    for (const k of FINANCE_KEYS) expect(PERMISSION_MIN_RELEASE[k], k).toBeUndefined();
    expect(ROLE_PERMISSIONS.FINANCE).not.toContain("export.bulk");
    expect(ROLE_PERMISSIONS.MANAGEMENT).toContain("export.bulk");
    expect(PERMISSION_IMPLICATIONS["finance.manage.payments"]).not.toContain("export.bulk");
  });

  it("reserves departments.manage per UC-D3 (even before the key exists), and leaves finance.export and the invoice keys delegable", () => {
    expect(validatePermissionKeys(["departments.manage"]).map((i) => i.code)).toEqual(["RESERVED_PERMISSION"]);
    const grantable = new Set(grantableKeys());
    for (const k of ["finance.export", "finance.reports.view", "invoices.view", "invoices.create", "invoices.edit", "invoices.send", "quotes.view", "quotes.edit", "quotes.send"]) {
      expect(grantable.has(k), k).toBe(true);
    }
  });

  it("asks for a way to open the record before it lets a custom role edit or send", () => {
    expect(validatePermissionKeys(["quotes.edit"]).map((i) => i.code)).toEqual(["MISSING_VIEW_PERMISSION"]);
    expect(validatePermissionKeys(["quotes.edit", "quotes.view"])).toEqual([]);
    expect(validatePermissionKeys(["quotes.send", "quotes.create"])).toEqual([]);
    expect(validatePermissionKeys(["invoices.create"]).map((i) => i.code)).toEqual(["MISSING_VIEW_PERMISSION"]);
    expect(validatePermissionKeys(["invoices.create", "invoices.view"])).toEqual([]);
  });
});

describe("existing organisations (database): the migration and the sync agree, custom roles keep their stored keys, tenants stay apart", () => {
  async function setup(name: string) {
    const org = await createTestOrganization(name);
    await setOrganizationRelease(org.id, "v2");
    const management = await createTestContext(org.id, "MANAGEMENT");
    return { org, management };
  }

  async function ctxWithRole(organizationId: string, roleId: string): Promise<AuthContext> {
    const { membership, user } = await createTestMembership(organizationId, "SALES", "r1.member");
    await adminDb.membership.update({ where: { id: membership.id }, data: { roleId } });
    const ctx = await resolveActiveMembership(user.id, organizationId);
    if (!ctx) throw new Error("expected an active membership");
    return ctx;
  }

  it("has the ten catalogue rows and the platform role links the migration and seedData both define, and the sync changes nothing", async () => {
    const rows = await adminDb.permission.findMany({ where: { key: { in: [...UC_R1_NEW_KEYS] } } });
    expect(rows.map((r) => r.key).sort()).toEqual([...UC_R1_NEW_KEYS].sort());

    for (const role of ROLES) {
      const links = await adminDb.rolePermission.findMany({ where: { role: { key: role.key, organizationId: null }, permission: { key: { in: [...UC_R1_NEW_KEYS] } } }, include: { permission: true } });
      expect(links.map((l) => l.permission.key).sort(), role.key).toEqual((ROLE_PERMISSIONS[role.key] ?? []).filter((k) => NEW.has(k)).sort());
    }

    const second = await seedRolesAndPermissions();
    expect(second.changes, "a second sync must change nothing and write no audit event").toEqual({});
  });

  it("leaves a custom role's stored keys alone, derives the finer keys for it, and survives a catalogue sync", async () => {
    const { management } = await setup("R1Custom");
    const stored = ["deals.view.all", "contacts.view", "quotes.create"];
    const role = await createRole(management, { name: "Quote writers", permissionKeys: stored });
    expect([...role.permissionKeys].sort()).toEqual([...stored].sort());

    await seedRolesAndPermissions();
    expect([...(await getRole(management, role.id)).permissionKeys].sort(), "the sync never touches a custom role").toEqual([...stored].sort());

    const member = await ctxWithRole(management.organizationId, role.id);
    for (const k of QUOTE_KEYS) expect(member.permissionKeys, k).toContain(k);
    for (const k of FINANCE_KEYS) expect(member.permissionKeys, k).not.toContain(k);
    expect(member.permissionKeys).toContain("quotes.create");
  });

  it("gives a custom role created from Management the new quote and invoice keys but never a payment key", async () => {
    const { management } = await setup("R1FromMgmt");
    const role = await createRole(management, { name: "Almost management", basedOnRoleKey: "MANAGEMENT" });
    for (const k of ["finance.view.payments", "finance.manage.payments", "payments.manage", "payments.record"]) expect(role.permissionKeys, k).not.toContain(k);
    expect(role.permissionKeys).toContain("quotes.view");
  });

  it("keeps one organisation's custom role out of another's list (the new keys add no table; the role tables stay row-level secured)", async () => {
    const a = await setup("R1TenantA");
    const b = await setup("R1TenantB");
    const role = await createRole(a.management, { name: "Only in A", permissionKeys: ["contacts.view", "quotes.view"] });
    const seenByB = await listRoles(b.management, { includeArchived: true });
    expect(seenByB.roles.map((r) => r.id)).not.toContain(role.id);
    expect((await listRoles(a.management)).roles.map((r) => r.id), "A still sees it").toContain(role.id);
    await expect(getRole(b.management, role.id)).rejects.toThrow();
  });
});
