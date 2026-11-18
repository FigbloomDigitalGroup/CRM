import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { dismissAnnouncement } from "@/services/platformAnnouncementService";

/** Dismiss a banner for this member. It stays dismissed (or comes back tomorrow, by the announcement's rule). FIG-1185 (V2). */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; announcementId: string }> }) {
  return handleRoute(async () => {
    const p = await params;
    const ctx = await resolveGatedContext(p.orgSlug, "release.v2");
    return dismissAnnouncement(ctx, p.announcementId);
  });
}
