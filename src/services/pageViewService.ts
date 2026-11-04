import { after } from "next/server";
import type { AuthContext } from "../auth/context";
import { resolveRequestContext, snapshotRequestCookies } from "../auth/requestContext";
import { requirePermission } from "../auth/context";
import { NoActiveMembershipError, NotFoundError, UnauthorizedError } from "../auth/errors";
import {
  createPageView,
  getPageUsageSummary as getPageUsageSummaryRecord,
  type PageUsageSummary,
} from "../repositories/pageViews";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fixed set of page labels every call site passes a literal from -- never a
 * raw pathname (which could carry a record id) and never derived from
 * request data. Add a new one here (and at its call site) rather than
 * inventing a label ad hoc, so "visits per page" stays a small, readable
 * table instead of one row per URL ever hit.
 */
export const PAGE_VIEW_LABELS = [
  "dashboard",
  "leads",
  "leads_detail",
  "deals",
  "deals_detail",
  "companies",
  "companies_detail",
  "contacts",
  "contacts_detail",
  "tasks",
  "reports",
  "settings",
] as const;

export type PageViewLabel = (typeof PAGE_VIEW_LABELS)[number];

/**
 * Best-effort instrumentation (FIG-752, FIG-444 metric A6): a failure here
 * must never turn an otherwise-successful page render into an error --
 * same principle as the website-lead acknowledgement email in
 * notificationService.ts. Deliberately records only `page` + membership +
 * timestamp; see the PageView model's own doc comment for why nothing else
 * is captured.
 */
export async function recordPageView(
  ctx: AuthContext,
  page: PageViewLabel,
): Promise<void> {
  try {
    await createPageView(ctx.organizationId, ctx.membershipId, page);
  } catch (err) {
    console.error(`Failed to record a page view for "${page}":`, err);
  }
}

/**
 * Records a page view without making the page wait for it. Called from a server page, it reads the request's cookies, hands the response back
 * straight away and does the rest (who the viewer is, and the insert) once the page is on its way with `after()`. The page therefore costs the
 * person no database round trips, which is the point: this write used to sit in front of every page click. Still best-effort, like
 * `recordPageView`: nothing here can fail the page.
 */
export async function schedulePageView(orgSlug: string, page: PageViewLabel): Promise<void> {
  try {
    const cookieJar = await snapshotRequestCookies();
    after(async () => {
      try {
        // Not the per-render cached lookup: this runs after the render, with the snapshot taken above.
        const ctx = await resolveRequestContext(orgSlug, cookieJar);
        await recordPageView(ctx, page);
      } catch (err) {
        // Signed out, or not a member: the page itself already answered that; there is just nothing to count.
        if (!(err instanceof UnauthorizedError || err instanceof NoActiveMembershipError || err instanceof NotFoundError)) {
          console.error(`Failed to record a page view for "${page}":`, err);
        }
      }
    });
  } catch (err) {
    console.error(`Failed to schedule a page view for "${page}":`, err);
  }
}

/** Management-only (FIG-752 AC: "a small usage view for Management"). */
export async function getWeeklyPageUsage(ctx: AuthContext): Promise<PageUsageSummary> {
  requirePermission(ctx, "reporting.view.all");
  const since = new Date(Date.now() - WEEK_MS);
  return getPageUsageSummaryRecord(ctx.organizationId, since);
}
