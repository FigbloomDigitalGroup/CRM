import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listNotificationCentre } from "@/services/notificationCentreService";

// The notification centre (FIG-1040, B2.11): paged, filterable by type (comma separated), unread
// and archived. The response carries `unreadCount`, which always matches the unread list.
const QuerySchema = z.object({
  unreadOnly: z.enum(["true", "false"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
  type: z.string().max(400).optional(),
  ...pageQueryShape,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    const page = await listNotificationCentre(ctx, {
      unreadOnly: query.unreadOnly === "true",
      archived: query.archived === "true",
      types: query.type ? query.type.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      paging: toPageRequest(query),
    });
    // `notifications` is kept for existing callers.
    return { ...page, notifications: page.items };
  });
}
