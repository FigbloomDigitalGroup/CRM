import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveRequestContext, resolveUserContext } from "@/auth/requestContext";
import { getMemberContext } from "@/services/meContextService";
import { recordPageView } from "@/services/pageViewService";
import { HomeScreen } from "@/ui/screens/home/Home";

/** Arriving from a sign-in page (or with no referrer at all) is "just signed in": that is when the member's start page applies. */
const FROM_SIGN_IN = /^\/(login|signup|accept-invite|reset-password|forgot-password)(\/|$)/;

async function justSignedIn(): Promise<boolean> {
  const referer = (await headers()).get("referer");
  if (!referer) return true;
  try {
    return FROM_SIGN_IN.test(new URL(referer).pathname);
  } catch {
    return true;
  }
}

/**
 * The home page (D1, D2, D3). The role's sections are read by the screen from `GET /api/orgs/{org}/dashboard`; this server part records the
 * page view and honours the start-page preference (B1.08): a member whose start page is not the dashboard lands there on sign-in, and the
 * sidebar's Dashboard link still opens the dashboard.
 */
export default async function OrgDashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  if (await justSignedIn()) {
    const identity = await resolveUserContext();
    const me = await getMemberContext({ userId: identity.userId, session: identity.session, orgSlug });
    const path = me.preferences?.startPage.path;
    if (path) redirect(`/o/${orgSlug}${path}`);
  }

  await recordPageView(ctx, "dashboard");
  return <HomeScreen />;
}
