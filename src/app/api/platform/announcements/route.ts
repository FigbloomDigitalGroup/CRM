import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { createAnnouncement, listAnnouncements } from "@/services/platformAnnouncementService";

const Body = z.strictObject({
  title: z.string({ error: "A title is required." }),
  body: z.string({ error: "A message is required." }),
  kind: z.string().optional(),
  severity: z.string().optional(),
  startsAt: z.string({ error: "A start is required." }),
  endsAt: z.string({ error: "An end is required." }),
  targetAll: z.boolean().optional(),
  organizationIds: z.array(z.string()).optional(),
  dismissRule: z.string().optional(),
});

/** Announcements, newest first, with their computed status (PL13). FIG-1185 (V2). */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requirePlatformV2Api("platform.announcements.manage");
    return listAnnouncements(parseQueryParams(new URL(request.url).searchParams, z.object({ status: z.string().optional() })));
  });
}

/** Publish an announcement to every organisation or a list. Needs a fresh second-step proof. Audited. FIG-1185 (V2). */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.announcements.manage");
    await requireRecentVerification(platform);
    const body = await parseJsonBody(request, Body);
    return createAnnouncement(platform, body, { requestId: request.headers.get("x-request-id") });
  });
}
