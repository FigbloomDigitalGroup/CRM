import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getDashboardLayout, saveDashboardLayout } from "../src/services/dashboardLayoutService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/**
 * UC-W1 (FIG-1802): dashboard layouts per role. DB-backed (organisation setting row `dashboard.layouts`).
 * Covers: default when nothing is saved, Management-only writes, audit, idempotent PUT, reset, other-organisation isolation, and that a stored
 * layout never reveals a widget the reader's keys do not grant (rule 7).
 */
describe("dashboard layouts (UC-W1)", () => {
  it("gives every member the default until Management saves, and only Management saves", async () => {
    const org = await createTestOrganization("Layouts");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    expect(await getDashboardLayout(sales)).toMatchObject({ kind: "sales", isDefault: true });
    await expect(saveDashboardLayout(sales, { kind: "sales", widgets: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDashboardLayout(sales, "finance")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveDashboardLayout(management, { kind: "sales", widgets: [{ id: "ageing", visible: true }] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("hides and reorders for the role, audits once, is idempotent, and resets", async () => {
    const org = await createTestOrganization("Layouts2");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const widgets = [{ id: "quotes", visible: true }, { id: "todo", visible: false }];
    await saveDashboardLayout(management, { kind: "sales", widgets });
    await saveDashboardLayout(management, { kind: "sales", widgets });
    const mine = await getDashboardLayout(sales);
    expect(mine.isDefault).toBe(false);
    // A fresh organisation is on V1, where Sales does not hold quotes.view: the saved quotes entry is dropped for them (a layout never reveals), the rest keeps its order.
    expect(mine.widgets.find((w) => w.id === "quotes")).toBeUndefined();
    expect(mine.widgets[0]).toEqual({ id: "todo", visible: false });
    expect(mine.widgets.find((w) => w.id === "todo")?.visible).toBe(false);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "dashboard_layout.updated" } })).toBe(1);
    await saveDashboardLayout(management, { kind: "sales", widgets: null });
    expect((await getDashboardLayout(sales)).isDefault).toBe(true);
  });

  it("never reveals a widget the reader's keys do not grant, and one organisation never sees another's layout", async () => {
    const org = await createTestOrganization("Layouts3");
    const other = await createTestOrganization("Layouts4");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const finance = await createTestContext(org.id, "FINANCE");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const otherSales = await createTestContext(other.id, "SALES");
    await saveDashboardLayout(management, { kind: "finance", widgets: [{ id: "ageing", visible: true }] });
    expect((await getDashboardLayout(finance)).widgets.map((w) => w.id)).toContain("ageing");
    // Delivery has no invoice keys; its own home never lists finance widgets, and Management's editor view of "finance" is configuration only.
    expect((await getDashboardLayout(delivery)).widgets.map((w) => w.id)).not.toContain("ageing");
    expect((await getDashboardLayout(otherSales)).isDefault).toBe(true);
  });
});
