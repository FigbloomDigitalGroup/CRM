import { describe, expect, it } from "vitest";
import { evaluate, formatReport, type TableState } from "../scripts/lib/migrationVerify";

const t = (over: Partial<TableState> = {}): TableState => ({
  name: "leads",
  rows: 10,
  hasOrganizationId: true,
  rlsEnabled: true,
  rlsForced: true,
  policies: 1,
  appCanSelect: true,
  ...over,
});

const good = { tables: [t(), t({ name: "roles", hasOrganizationId: false, rlsEnabled: false, rlsForced: false, policies: 0 })], before: { leads: 10, roles: 3 }, appRoleExists: true };

describe("post-migration verification report (FIG-1603)", () => {
  it("passes a healthy database", () => {
    const r = evaluate({ ...good, tables: good.tables.map((x) => ({ ...x, rows: x.rows + 1 })) });
    expect(r.ok).toBe(true);
    expect(formatReport(r)).toContain("PASS");
    expect(formatReport(r)).not.toContain("FAIL");
  });

  it("fails when a tenant table loses RLS", () => {
    const r = evaluate({ ...good, tables: [t({ rlsEnabled: false })] });
    expect(r.ok).toBe(false);
    expect(formatReport(r)).toContain("FAIL  RLS on for every tenant table: missing or not forced: leads");
  });

  it("fails when RLS is on but not forced, or a tenant table has no policy", () => {
    expect(evaluate({ ...good, tables: [t({ rlsForced: false })] }).ok).toBe(false);
    expect(evaluate({ ...good, tables: [t({ policies: 0 })] }).ok).toBe(false);
  });

  it("fails when the app role lost its grants or does not exist", () => {
    expect(evaluate({ ...good, tables: [t({ appCanSelect: false })] }).ok).toBe(false);
    expect(evaluate({ ...good, appRoleExists: false }).ok).toBe(false);
  });

  it("fails when a table disappears or loses rows against the snapshot", () => {
    const gone = evaluate({ ...good, tables: [t()] });
    expect(gone.checks.find((c) => c.name === "No table disappeared")?.ok).toBe(false);
    const shrunk = evaluate({ ...good, tables: [t({ rows: 4 }), good.tables[1]] });
    const c = shrunk.checks.find((x) => x.name === "No table lost rows");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("leads 10 to 4");
  });

  it("does not pass without a snapshot", () => {
    expect(evaluate({ ...good, before: undefined }).ok).toBe(false);
  });

  it("checks the read as the app role when a connection was given", () => {
    expect(evaluate({ ...good, appRead: { connected: true, ownOrgVisible: true, noOrgSeesRows: 0 } }).ok).toBe(true);
    expect(evaluate({ ...good, appRead: { connected: true, ownOrgVisible: true, noOrgSeesRows: 3 } }).ok).toBe(false);
    expect(evaluate({ ...good, appRead: { connected: false, ownOrgVisible: false, noOrgSeesRows: 0, detail: "x" } }).ok).toBe(false);
  });

  it("never prints a connection string", () => {
    const r = evaluate({ ...good, appRead: { connected: false, ownOrgVisible: false, noOrgSeesRows: 0, detail: "app role check failed: <url>" } });
    expect(formatReport(r)).not.toMatch(/postgres(ql)?:\/\//);
  });
});
