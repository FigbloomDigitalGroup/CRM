import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

// Mocks the repository layer, not pageViewService itself, same shape as
// notificationService.test.ts mocking the email-sending layer underneath a
// real service function -- `createPageView` wraps the real implementation
// by default, so every test except the one below still performs a real
// write; `mockRejectedValueOnce` only overrides a single call and reverts
// on its own, so no afterEach reset is needed.
vi.mock("../src/repositories/pageViews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/repositories/pageViews")>();
  return { ...actual, createPageView: vi.fn(actual.createPageView) };
});

import * as pageViewsRepo from "../src/repositories/pageViews";
import { getWeeklyPageUsage, recordPageView } from "../src/services/pageViewService";

describe("pageViewService: recordPageView", () => {
  it("records exactly page + membership + organization + a timestamp, nothing else", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await recordPageView(ctx, "leads");

    const rows = await adminDb.pageView.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      membershipId: ctx.membershipId,
      page: "leads",
    });
    expect(rows[0]!.viewedAt).toBeInstanceOf(Date);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["id", "organizationId", "membershipId", "page", "viewedAt"].sort(),
    );
  });

  it("never throws when the underlying write fails -- a page render must never break because of instrumentation", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(pageViewsRepo.createPageView).mockRejectedValueOnce(new Error("db down"));

    await expect(recordPageView(ctx, "leads")).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("pageViewService: getWeeklyPageUsage", () => {
  it("requires reporting.view.all", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");

    await expect(getWeeklyPageUsage(salesCtx)).rejects.toThrow(ForbiddenError);
  });

  it("aggregates visits and distinct active users per page, and org-wide", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES", "s1");
    const sales2Ctx = await createTestContext(org.id, "SALES", "s2");

    // Management visits "reports" twice, Sales visits "leads" once and
    // "reports" once, Sales 2 visits "leads" once -- so "leads" has 2
    // visits/2 active users, "reports" has 3 visits/2 active users
    // (Management counted once despite two visits), and 3 distinct members
    // were active org-wide.
    await recordPageView(managementCtx, "reports");
    await recordPageView(managementCtx, "reports");
    await recordPageView(salesCtx, "leads");
    await recordPageView(salesCtx, "reports");
    await recordPageView(sales2Ctx, "leads");

    const summary = await getWeeklyPageUsage(managementCtx);
    expect(summary.totalActiveUsers).toBe(3);

    const leadsRow = summary.pages.find((p) => p.page === "leads");
    const reportsRow = summary.pages.find((p) => p.page === "reports");
    expect(leadsRow).toEqual({ page: "leads", visits: 2, activeUsers: 2 });
    expect(reportsRow).toEqual({ page: "reports", visits: 3, activeUsers: 2 });
  });

  it("only counts page views from the last 7 days", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");

    await adminDb.pageView.create({
      data: {
        organizationId: org.id,
        membershipId: managementCtx.membershipId,
        page: "reports",
        viewedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });
    await recordPageView(managementCtx, "reports");

    const summary = await getWeeklyPageUsage(managementCtx);
    expect(summary.totalActiveUsers).toBe(1);
    expect(summary.pages.find((p) => p.page === "reports")).toEqual({
      page: "reports",
      visits: 1,
      activeUsers: 1,
    });
  });

  it("scopes to the caller's own organization only", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const managementA = await createTestContext(orgA.id, "MANAGEMENT");
    const managementB = await createTestContext(orgB.id, "MANAGEMENT");

    await recordPageView(managementA, "leads");
    await recordPageView(managementB, "leads");
    await recordPageView(managementB, "leads");

    const summaryA = await getWeeklyPageUsage(managementA);
    expect(summaryA.totalActiveUsers).toBe(1);
    expect(summaryA.pages.find((p) => p.page === "leads")?.visits).toBe(1);
  });
});
