import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { maskAuditSnapshot } from "../src/auth/masking";
import { createCatalogueEntry, getCatalogueEntry, listCatalogue, updateCatalogueEntry } from "../src/services/catalogueService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createV11Organization } from "./helpers/commercial";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("catalogue (FIG-1142, B6.10)", () => {
  it("Management manages items; cost and margin are masked for every other role in list and detail", async () => {
    const org = await createV11Organization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const finance = await createTestContext(org.id, "FINANCE");

    const cctv = await createCatalogueEntry(management, { name: "CCTV camera", sku: "CAM-4MP", price: 18500, cost: "11000.50", unit: "camera", kind: "PRODUCT" });
    expect(cctv).toMatchObject({ price: 18500, cost: 11000.5, marginPct: 41, costMasked: false, taxable: true, status: "ACTIVE", currency: "KES" });
    await createCatalogueEntry(management, { name: "Support retainer", price: 25000, cost: 9000, unit: "month", kind: "SERVICE", taxable: false });

    for (const ctx of [sales, finance]) {
      const page = await listCatalogue(ctx);
      expect(page.total).toBe(2);
      for (const item of page.items) expect(item).toMatchObject({ cost: null, marginPct: null, costMasked: true });
      expect(JSON.stringify(page)).not.toContain("11000");
      const one = await getCatalogueEntry(ctx, cctv.id);
      expect(one).toMatchObject({ price: 18500, cost: null, marginPct: null, costMasked: true });
      expect(JSON.stringify(one)).not.toContain("11000");
    }
    expect((await listCatalogue(management)).items.every((i) => i.cost !== null)).toBe(true);
  });

  it("only Management writes: Sales may read but not write, and nobody without the cost permission can set a cost", async () => {
    const org = await createV11Organization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const item = await createCatalogueEntry(management, { name: "Website", price: 180000 });

    await expect(createCatalogueEntry(sales, { name: "Nope", price: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateCatalogueEntry(sales, item.id, { price: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCatalogue(delivery)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCatalogueEntry(delivery, item.id)).rejects.toBeInstanceOf(ForbiddenError);

    // A catalogue manager who may not see margin cannot set a cost either (simulated by removing the key).
    const managerWithoutMargin = { ...management, permissionKeys: management.permissionKeys.filter((k) => k !== "deals.margin") };
    await expect(updateCatalogueEntry(managerWithoutMargin, item.id, { cost: 5 })).rejects.toBeInstanceOf(ForbiddenError);
    const edited = await updateCatalogueEntry(managerWithoutMargin, item.id, { price: 175000 });
    expect(edited).toMatchObject({ price: 175000, cost: null, costMasked: true });
  });

  it("validates input, keeps names and SKUs unique, and hidden items are offered to managers only", async () => {
    const org = await createV11Organization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");

    const bad = await issuesOf(createCatalogueEntry(management, { name: " ", price: -5, kind: "GADGET", currency: "kes1", unit: "" }));
    expect(bad.map((i) => i.path).sort()).toEqual(["currency", "kind", "name", "price", "unit"]);
    expect((await issuesOf(createCatalogueEntry(management, { name: "X", price: "12.345" })))[0]).toMatchObject({ code: "INVALID_AMOUNT" });

    const a = await createCatalogueEntry(management, { name: "NVR recorder", sku: "NVR-16", price: 65000 });
    expect((await issuesOf(createCatalogueEntry(management, { name: "nvr RECORDER", price: 1 })))[0]).toMatchObject({ code: "DUPLICATE_ITEM" });
    expect((await issuesOf(createCatalogueEntry(management, { name: "Other", sku: "nvr-16", price: 1 })))[0]).toMatchObject({ code: "DUPLICATE_SKU" });

    await updateCatalogueEntry(management, a.id, { status: "HIDDEN" });
    expect((await listCatalogue(sales)).total).toBe(0);
    expect((await listCatalogue(management)).total).toBe(1);
    expect((await listCatalogue(management, { status: "HIDDEN" })).total).toBe(1);
    await expect(getCatalogueEntry(sales, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await updateCatalogueEntry(management, a.id, { status: "ACTIVE" });
    expect((await listCatalogue(sales, { q: "nvr" })).total).toBe(1);
    expect((await listCatalogue(sales, { kind: "SERVICE" })).total).toBe(0);

    const actions = (await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityType: "CatalogueItem" }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["catalogue_item.created", "catalogue_item.hidden", "catalogue_item.shown"]);
  });

  it("audit snapshots lose price and cost for a reader without the permissions", async () => {
    const org = await createV11Organization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const item = await createCatalogueEntry(management, { name: "Starlink kit", price: 95000, cost: 72000 });
    const event = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, entityId: item.id } });
    expect(maskAuditSnapshot(sales, "CatalogueItem", event.newValue)).toMatchObject({ price: null, cost: null, name: "Starlink kit" });
    expect(maskAuditSnapshot(management, "CatalogueItem", event.newValue)).toMatchObject({ price: 95000, cost: 72000 });
  });

  it("is isolated per organisation and unavailable before release V1.1", async () => {
    const orgA = await createV11Organization();
    const orgB = await createV11Organization();
    const mgmtA = await createTestContext(orgA.id, "MANAGEMENT");
    const mgmtB = await createTestContext(orgB.id, "MANAGEMENT");
    const item = await createCatalogueEntry(mgmtA, { name: "Only in org A", price: 10 });
    expect((await listCatalogue(mgmtB)).total).toBe(0);
    await expect(getCatalogueEntry(mgmtB, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCatalogueEntry(mgmtB, item.id, { price: 1 })).rejects.toBeInstanceOf(NotFoundError);

    // The database wall: the application role, in the other organisation context, sees no row.
    const { withOrgContext } = await import("../src/db/orgScopedClient");
    expect(await withOrgContext(orgB.id, (tx) => tx.catalogueItem.findMany({ where: { id: item.id } }))).toEqual([]);
    await expect(withOrgContext(orgB.id, (tx) => tx.catalogueItem.create({ data: { organizationId: orgA.id, name: "Smuggled", price: 1 } }))).rejects.toThrow();

    const v1 = await createTestOrganization();
    const v1Management = await createTestContext(v1.id, "MANAGEMENT");
    await expect(listCatalogue(v1Management)).rejects.toThrow(/not available/i);
  });
});
