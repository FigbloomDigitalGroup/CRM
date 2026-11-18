import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { cancelAnnouncement, getAnnouncement, updateAnnouncement } from "@/services/platformAnnouncementService";

const Patch = z.strictObject({
  title: z.string().optional(),
  body: z.string().optional(),
  kind: z.string().optional(),
  severity: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  targetAll: z.boolean().optional(),
  organizationIds: z.array(z.string()).optional(),
  dismissRule: z.string().optional(),
});

/** One announcement (PL13). FIG-1185 (V2). */
export async function GET(_request: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  return handleRoute(async () => {
    await requirePlatformV2Api("platform.announcements.manage");
    return getAnnouncement((await params).announcementId);
  });
}

/** Change a scheduled or live announcement. A cancelled or expired one cannot be changed. FIG-1185 (V2). */
export async function PATCH(request: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.announcements.manage");
    await requireRecentVerification(platform);
    const body = await parseJsonBody(request, Patch);
    return updateAnnouncement(platform, (await params).announcementId, body, { requestId: request.headers.get("x-request-id") });
  });
}

/** Cancel an announcement: it disappears from every organisation's feed at once. FIG-1185 (V2). */
export async function DELETE(request: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.announcements.manage");
    await requireRecentVerification(platform);
    return cancelAnnouncement(platform, (await params).announcementId, { requestId: request.headers.get("x-request-id") });
  });
}
