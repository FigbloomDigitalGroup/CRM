import { describe, expect, it } from "vitest";
import { APP_ROLE_CLOSED_TABLES } from "../scripts/lib/appRoleRestrictedTables";
import { evaluate, formatReport, type TableState } from "../scripts/lib/migrationVerify";

// UC-F7: the verify:migration false failure ("App role can read every table" failed on a healthy database because 21 tables are deliberately closed
// to the app role) is fixed by naming the closed set, checking it in BOTH directions, and adding the snapshot flows the tool lacked.

const t = (name: string, over: Partial<TableState> = {}): TableState => ({
  name,
  rows: 5,
  hasOrganizationId: true,
  rlsEnabled: true,
  rlsForced: true,
  policies: 1,
  appCanSelect: true,
  ...over,
});
const closed = (name: string) => t(name, { hasOrganizationId: false, rlsEnabled: false, rlsForced: false, policies: 0, appCanSelect: false });
const base = { appRoleExists: true, noSnapshot: true };
const checkOf = (r: ReturnType<typeof evaluate>, name: string) => r.checks.find((c) => c.name === name);

describe("closed tables are explicit (UC-F7)", () => {
  it("passes a healthy database where the closed tables are closed", () => {
    const r = evaluate({ ...base, tables: [t("leads"), closed("platform_sessions"), closed("password_reset_tokens"), closed("users")] });
    expect(checkOf(r, "App role can read every table it should")?.ok).toBe(true);
    expect(checkOf(r, "App role cannot read the closed tables")?.ok).toBe(true);
  });

  it("still fails when an ordinary table lost its grant", () => {
    const r = evaluate({ ...base, tables: [t("leads", { appCanSelect: false }), closed("platform_sessions")] });
    expect(checkOf(r, "App role can read every table it should")?.ok).toBe(false);
    expect(checkOf(r, "App role can read every table it should")?.detail).toContain("leads");
  });

  it("fails when a closed table has become readable (the check runs both ways)", () => {
    const r = evaluate({ ...base, tables: [t("leads"), t("password_reset_tokens", { hasOrganizationId: false })] });
    expect(checkOf(r, "App role cannot read the closed tables")?.ok).toBe(false);
    expect(checkOf(r, "App role cannot read the closed tables")?.detail).toContain("password_reset_tokens");
  });

  it("ignores a closed table that does not exist yet", () => {
    expect(checkOf(evaluate({ ...base, tables: [t("leads")] }), "App role cannot read the closed tables")?.ok).toBe(true);
  });

  it("lists the credential and platform tables, and not an ordinary one", () => {
    for (const n of ["password_reset_tokens", "user_two_step", "platform_identities", "auth_rate_limit_attempts"]) expect(APP_ROLE_CLOSED_TABLES).toContain(n);
    for (const n of ["leads", "deals", "invoices", "users"]) expect(APP_ROLE_CLOSED_TABLES).not.toContain(n);
  });
});

describe("snapshot flows (UC-F7)", () => {
  const tables = [t("leads", { rows: 10 }), t("deals", { rows: 4 })];

  it("fails without a snapshot unless --no-snapshot says this is a health check, and then prints SKIP", () => {
    expect(evaluate({ tables, appRoleExists: true }).ok).toBe(false);
    const r = evaluate({ tables, appRoleExists: true, noSnapshot: true });
    expect(r.ok).toBe(true);
    expect(formatReport(r)).toContain("SKIP  Row counts compared with a snapshot");
  });

  it("without --exact, extra rows pass (the old '<' rule)", () => {
    expect(evaluate({ tables, appRoleExists: true, before: { leads: 9, deals: 4 } }).ok).toBe(true);
  });

  it("with --exact, one extra row fails, and so does a new table", () => {
    const more = evaluate({ tables, appRoleExists: true, before: { leads: 9, deals: 4 }, exact: true });
    expect(more.ok).toBe(false);
    expect(checkOf(more, "Counts equal the snapshot (--exact)")?.detail).toContain("leads 9 to 10");
    const added = evaluate({ tables: [...tables, t("brand_new")], appRoleExists: true, before: { leads: 10, deals: 4 }, exact: true });
    expect(checkOf(added, "Counts equal the snapshot (--exact)")?.detail).toContain("brand_new");
  });

  it("with --exact, equal counts pass", () => {
    expect(evaluate({ tables, appRoleExists: true, before: { leads: 10, deals: 4 }, exact: true }).ok).toBe(true);
  });
});
