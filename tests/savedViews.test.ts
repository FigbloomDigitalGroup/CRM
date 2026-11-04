import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrgContext } from "../src/db/orgScopedClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { parseViewParts, restrictedKeyPermission, sanitiseForViewer, ViewPartsError } from "../src/lib/savedViews";
import { createView, deleteView, getView, listViews, reorderPins, setPinned, updateView } from "../src/services/savedViewService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/** FIG-1148 (B6.16): saved views, personal and shared, pinned in the sidebar. Authorization tests. */

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

async function world() {
  const org = await createTestOrganization("Views Org");
  return {
    org,
    management: await createTestContext(org.id, "MANAGEMENT"),
    salesA: await createTestContext(org.id, "SALES"),
    salesB: await createTestContext(org.id, "SALES"),
    delivery: await createTestContext(org.id, "DELIVERY"),
    finance: await createTestContext(org.id, "FINANCE"),
    technical: await createTestContext(org.id, "RESTRICTED_TECHNICAL"),
  };
}

const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

describe("view rules (pure)", () => {
  it("knows which parts need a permission", () => {
    expect(restrictedKeyPermission("valueMin")).toBe("deals.view.value");
    expect(restrictedKeyPermission("margin")).toBe("deals.margin");
    expect(restrictedKeyPermission("paymentStatus")).toBe("finance.view.payments");
    expect(restrictedKeyPermission("temp")).toBeNull();
  });

  it("checks shape and size", () => {
    expect(() => parseViewParts({ filters: [] })).toThrow(ViewPartsError);
    expect(() => parseViewParts({ filters: { "bad key!": "x" } })).toThrow(ViewPartsError);
    expect(() => parseViewParts({ filters: { a: { nested: 1 } } })).toThrow(ViewPartsError);
    expect(() => parseViewParts({ sort: { field: "name", direction: "up" } })).toThrow(ViewPartsError);
    expect(() => parseViewParts({ columns: ["a", 3] })).toThrow(ViewPartsError);
    expect(() => parseViewParts({ filters: { notes: "x".repeat(5000) } })).toThrow(ViewPartsError);
    expect(parseViewParts({ filters: { temp: "HOT", tags: ["a", "b"] }, sort: { field: "name", direction: "asc" }, columns: ["name", "name", "owner"] })).toEqual({
      filters: { temp: "HOT", tags: ["a", "b"] },
      sort: { field: "name", direction: "asc" },
      columns: ["name", "owner"],
    });
  });

  it("removes restricted parts for a viewer and counts them", () => {
    const r = sanitiseForViewer({ filters: { stage: "X", valueMin: 5 }, sort: { field: "value", direction: "desc" }, columns: ["name", "margin"] }, ["deals.view.own"]);
    expect(r).toEqual({ parts: { filters: { stage: "X" }, sort: null, columns: ["name"] }, hiddenParts: 3 });
  });
});

describe("saved views: personal and shared", () => {
  it("a personal view is private to its owner", async () => {
    const w = await world();
    const v = await createView(w.salesA, { entity: "leads", name: "Hot leads", filters: { temp: "HOT" } });
    expect(v).toMatchObject({ scope: "PERSONAL", mine: true, canEdit: true, pinned: false, filters: { temp: "HOT" } });
    expect(ids(await listViews(w.salesA, { entity: "leads" }))).toEqual([v.id]);
    for (const other of [w.salesB, w.management]) {
      expect(ids(await listViews(other, { entity: "leads" }))).toEqual([]);
      await expect(getView(other, v.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(setPinned(other, v.id, true)).rejects.toBeInstanceOf(NotFoundError);
      await expect(updateView(other, v.id, { scope: "SHARED" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteView(other, v.id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("a shared view reaches only roles that may open that list, and only the owner changes it", async () => {
    const w = await world();
    const contacts = await createView(w.salesA, { entity: "contacts", name: "Recent", filters: { q: "a" } });
    const leads = await createView(w.salesA, { entity: "leads", name: "Mine" });
    await updateView(w.salesA, contacts.id, { scope: "SHARED" });
    await updateView(w.salesA, leads.id, { scope: "SHARED" });

    // Contacts: everyone who may open Contacts. Technical may not.
    for (const who of [w.salesB, w.management, w.delivery, w.finance]) expect(ids(await listViews(who, { entity: "contacts" }))).toEqual([contacts.id]);
    expect(ids(await listViews(w.technical))).toEqual([]);
    await expect(getView(w.technical, contacts.id)).rejects.toBeInstanceOf(NotFoundError);
    // Leads: Delivery and Finance have no lead list.
    expect(ids(await listViews(w.salesB, { entity: "leads" }))).toEqual([leads.id]);
    for (const who of [w.delivery, w.finance, w.technical]) {
      expect(ids(await listViews(who, { entity: "leads" }))).toEqual([]);
      await expect(getView(who, leads.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    const seen = await getView(w.salesB, contacts.id);
    expect(seen).toMatchObject({ mine: false, canEdit: false, ownerName: expect.any(String) });
    await expect(updateView(w.salesB, contacts.id, { name: "Hijack" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteView(w.management, contacts.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("needs views.share to share, and a role that cannot share can still keep personal views", async () => {
    const w = await world();
    await expect(createView(w.finance, { entity: "companies", name: "Shared", scope: "SHARED" })).rejects.toBeInstanceOf(ForbiddenError);
    const own = await createView(w.finance, { entity: "companies", name: "Mine" });
    await expect(updateView(w.finance, own.id, { scope: "SHARED" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getView(w.finance, own.id)).scope).toBe("PERSONAL");
    await expect(createView(w.technical, { entity: "companies", name: "No list" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a shared view never reveals more than the viewer's role: restricted parts are removed, and nobody saves what they cannot see", async () => {
    const w = await world();
    const v = await createView(w.management, {
      entity: "deals",
      name: "Big deals",
      scope: "SHARED",
      filters: { stage: "NEGOTIATION", valueMin: 5000000 },
      sort: { field: "value", direction: "desc" },
      columns: ["company", "value", "margin"],
    });
    expect(v).toMatchObject({ hiddenParts: 0, filters: { stage: "NEGOTIATION", valueMin: 5000000 } });
    const sales = await getView(w.salesA, v.id);
    expect(sales.hiddenParts).toBe(4);
    expect(sales.filters).toEqual({ stage: "NEGOTIATION" });
    expect(sales.sort).toBeNull();
    expect(sales.columns).toEqual(["company"]);
    expect(JSON.stringify(sales)).not.toContain("5000000");
    const delivery = await getView(w.delivery, v.id);
    expect(delivery.columns).toEqual(["company"]);
    expect(JSON.stringify(await listViews(w.salesA))).not.toContain("5000000");
    // Finance may open the won-deals list and sees values, but not margin.
    const finance = await getView(w.finance, v.id);
    expect(finance).toMatchObject({ hiddenParts: 1, columns: ["company", "value"], filters: { stage: "NEGOTIATION", valueMin: 5000000 } });
    // Technical has no deal list at all: 404.
    await expect(getView(w.technical, v.id)).rejects.toBeInstanceOf(NotFoundError);
    // Cannot save a view using a field you cannot see.
    const err = await createView(w.salesA, { entity: "deals", name: "Sneaky", filters: { valueMin: 1 } }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues[0]).toMatchObject({ code: "FIELD_NOT_VISIBLE", path: "filters" });
    await expect(createView(w.salesA, { entity: "deals", name: "Sneaky2", columns: ["margin"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateView(w.salesA, (await createView(w.salesA, { entity: "deals", name: "Ok" })).id, { sort: { field: "value", direction: "asc" } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("validates names, entities and limits", async () => {
    const w = await world();
    await createView(w.salesA, { entity: "leads", name: "Dup" });
    const dup = await createView(w.salesA, { entity: "leads", name: " dup " }).catch((e) => e);
    expect(dup.issues[0]).toMatchObject({ code: "DUPLICATE_VIEW" });
    // The same name is fine on another list, and for another person.
    await createView(w.salesA, { entity: "contacts", name: "Dup" });
    await createView(w.salesB, { entity: "leads", name: "Dup" });
    await expect(createView(w.salesA, { entity: "leads", name: "x".repeat(41) })).rejects.toBeInstanceOf(ValidationError);
    await expect(createView(w.salesA, { entity: "leads", name: "  " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createView(w.salesA, { entity: "invoices", name: "Nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createView(w.salesA, { entity: "leads", name: "Bad", scope: "TEAM" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createView(w.salesA, { entity: "leads", name: "Bad2", filters: { a: { b: 1 } } })).rejects.toBeInstanceOf(ValidationError);
    await expect(listViews(w.salesA, { entity: "invoices" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("saved views: pins", () => {
  it("pins are per person, ordered, and a shared view stays pinned only while it is shared", async () => {
    const w = await world();
    const a = await createView(w.salesA, { entity: "leads", name: "A", scope: "SHARED", pinned: true });
    const b = await createView(w.salesA, { entity: "contacts", name: "B", scope: "SHARED" });
    const c = await createView(w.salesA, { entity: "leads", name: "C" });
    expect(a.pinned).toBe(true);
    await setPinned(w.salesA, b.id, true);
    await setPinned(w.salesA, c.id, true);
    expect(ids(await listViews(w.salesA, { pinned: true }))).toEqual([a.id, b.id, c.id]);
    // Another person's sidebar is their own.
    expect(ids(await listViews(w.salesB, { pinned: true }))).toEqual([]);
    await setPinned(w.salesB, b.id, true);
    await setPinned(w.salesB, a.id, true);
    expect(ids(await listViews(w.salesB, { pinned: true }))).toEqual([b.id, a.id]);
    await expect(setPinned(w.salesB, c.id, true)).rejects.toBeInstanceOf(NotFoundError);

    expect(ids(await reorderPins(w.salesA, [c.id, a.id, b.id]))).toEqual([c.id, a.id, b.id]);
    expect(ids(await listViews(w.salesB, { pinned: true }))).toEqual([b.id, a.id]);
    await expect(reorderPins(w.salesA, [a.id])).rejects.toBeInstanceOf(ValidationError);
    await expect(reorderPins(w.salesA, [a.id, b.id, "nope"])).rejects.toBeInstanceOf(ValidationError);

    // Unsharing takes the view out of everyone else's sidebar, and keeps the owner's.
    await updateView(w.salesA, a.id, { scope: "PERSONAL" });
    expect(ids(await listViews(w.salesB, { pinned: true }))).toEqual([b.id]);
    expect(ids(await listViews(w.salesA, { pinned: true }))).toContain(a.id);
    // A role that loses access to the list loses the pin from the sidebar too.
    expect(ids(await listViews(w.technical, { pinned: true }))).toEqual([]);
    await setPinned(w.salesB, b.id, false);
    expect(ids(await listViews(w.salesB, { pinned: true }))).toEqual([]);
    await deleteView(w.salesA, b.id);
    expect(ids(await listViews(w.salesA, { pinned: true }))).not.toContain(b.id);
  });
});

describe("saved views: release gate and tenant isolation", () => {
  it("is unavailable while the release is V1", async () => {
    const w = await world();
    process.env.ACTIVE_RELEASE = "v1";
    try {
      await expect(listViews(w.salesA)).rejects.toMatchObject({ name: "FeatureUnavailableError" });
      await expect(createView(w.salesA, { entity: "leads", name: "X" })).rejects.toMatchObject({ name: "FeatureUnavailableError" });
    } finally {
      process.env.ACTIVE_RELEASE = "v1.1";
    }
  });

  it("another organisation cannot see, pin or change a view, in the service and under RLS", async () => {
    const a = await world();
    const b = await world();
    const v = await createView(a.salesA, { entity: "leads", name: "Shared one", scope: "SHARED", pinned: true });
    expect(ids(await listViews(b.management))).toEqual([]);
    await expect(getView(b.management, v.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setPinned(b.salesA, v.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateView(b.salesA, v.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteView(b.salesA, v.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withOrgContext(b.org.id, (tx) => tx.savedView.findMany({}))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.savedViewPin.findMany({}))).toEqual([]);
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.savedView.create({ data: { organizationId: a.org.id, ownerMembershipId: a.salesA.membershipId, entity: "leads", name: "Injected", filters: {} } }),
      ),
    ).rejects.toThrow();
    expect(await getView(a.salesA, v.id)).toMatchObject({ id: v.id });
  });
});
