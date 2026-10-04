import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as referenceCatalogService from "../src/services/referenceCatalogService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getLostReasonId,
} from "./helpers/fixtures";

const {
  listCatalog,
  createCatalogEntry,
  updateCatalogEntry,
  setCatalogEntryActive,
  reorderCatalogEntry,
} = referenceCatalogService;

describe("referenceCatalogService", () => {
  it("rejects every mutation for a role without configuration.manage", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lostReasonId = await getLostReasonId(org.id);

    await expect(createCatalogEntry(ctx, "leadSources", { name: "Trade Show" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      updateCatalogEntry(ctx, "lostReasons", lostReasonId, { name: "Renamed" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      setCatalogEntryActive(ctx, "lostReasons", lostReasonId, false),
    ).rejects.toThrow(ForbiddenError);
    await expect(reorderCatalogEntry(ctx, "lostReasons", lostReasonId, "up")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("derives a key from the name and sorts the new entry after every existing one", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const created = await createCatalogEntry(ctx, "leadSources", { name: "Trade Show / Expo" });
    expect(created.key).toBe("TRADE_SHOW_EXPO");

    const all = await listCatalog(ctx, "leadSources");
    expect(all[all.length - 1]!.id).toBe(created.id);
  });

  it("rejects a second entry whose derived key collides with an existing one", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await createCatalogEntry(ctx, "leadSources", { name: "Trade Show" });
    await expect(createCatalogEntry(ctx, "leadSources", { name: "trade show" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("renames and updates the description of an existing entry", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const lostReasonId = await getLostReasonId(org.id);

    const updated = await updateCatalogEntry(ctx, "lostReasons", lostReasonId, {
      name: "No Response (Renamed)",
      description: "Clarified wording",
    });
    expect(updated.name).toBe("No Response (Renamed)");
    expect(updated.description).toBe("Clarified wording");
  });

  it("supports pipeline-stage-only fields (probability, won/lost) on create and update", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const created = await createCatalogEntry(ctx, "pipelineStages", {
      name: "Contract Review",
      probability: 60,
    });
    expect(created.probability).toBe(60);
    expect(created.isWon).toBe(false);
    expect(created.isLost).toBe(false);

    const updated = await updateCatalogEntry(ctx, "pipelineStages", created.id, {
      probability: 90,
      isWon: true,
    });
    expect(updated.probability).toBe(90);
    expect(updated.isWon).toBe(true);
  });

  it("supports the service-only category field", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const created = await createCatalogEntry(ctx, "services", {
      name: "Drone Surveying",
      category: "Installation",
    });
    expect(created.category).toBe("Installation");

    const updated = await updateCatalogEntry(ctx, "services", created.id, {
      category: "Specialty",
    });
    expect(updated.category).toBe("Specialty");
  });

  it("deactivates and reactivates without touching existing references, and reports a real usage count", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const lostReasonId = await getLostReasonId(org.id);
    const leadStatusId = await getLeadStatusId(org.id);

    await adminDb.lead.create({
      data: { organizationId: org.id, leadStatusId, lostReasonId },
    });

    const [before] = (await listCatalog(ctx, "lostReasons")).filter(
      (e) => e.id === lostReasonId,
    );
    expect(before!.usageCount).toBe(1);

    const deactivated = await setCatalogEntryActive(ctx, "lostReasons", lostReasonId, false);
    expect(deactivated.isActive).toBe(false);

    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(lead.lostReasonId).toBe(lostReasonId);

    const reactivated = await setCatalogEntryActive(ctx, "lostReasons", lostReasonId, true);
    expect(reactivated.isActive).toBe(true);
  });

  it("reorders by swapping sequence with the adjacent entry, and no-ops at the boundary", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const before = await listCatalog(ctx, "lostReasons");
    const [first, second] = before;

    await reorderCatalogEntry(ctx, "lostReasons", second!.id, "up");
    const after = await listCatalog(ctx, "lostReasons");
    expect(after[0]!.id).toBe(second!.id);
    expect(after[1]!.id).toBe(first!.id);

    // Already first -- moving further up is a no-op, not an error.
    await reorderCatalogEntry(ctx, "lostReasons", second!.id, "up");
    const unchanged = await listCatalog(ctx, "lostReasons");
    expect(unchanged[0]!.id).toBe(second!.id);
  });

  it("throws NotFoundError for an id that doesn't belong to the catalog/organization", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const missingId = "00000000-0000-0000-0000-000000000000";

    await expect(
      updateCatalogEntry(ctx, "lostReasons", missingId, { name: "X" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      setCatalogEntryActive(ctx, "lostReasons", missingId, false),
    ).rejects.toThrow(NotFoundError);
    await expect(reorderCatalogEntry(ctx, "lostReasons", missingId, "up")).rejects.toThrow(
      NotFoundError,
    );
  });
});
