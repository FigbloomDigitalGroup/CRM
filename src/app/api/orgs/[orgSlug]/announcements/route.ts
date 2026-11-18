import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { listAnnouncementFeed } from "@/services/platformAnnouncementService";

/** The banners the signed-in member should see now: live, meant for this organisation, not dismissed (OS5). Any active member. FIG-1185 (V2). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveGatedContext((await params).orgSlug, "release.v2");
    return listAnnouncementFeed(ctx);
  });
}
