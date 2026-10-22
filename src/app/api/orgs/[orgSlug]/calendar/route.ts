import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCalendar } from "@/services/calendarService";

// Tasks and calls/meetings in a date window, for the month/week/day calendar
// (FIG-794, B2.10). `membershipId` is a member id or "all"; default is the caller.
const CalendarQuerySchema = z.object({
  from: requiredString("from is required."),
  to: requiredString("to is required."),
  membershipId: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, CalendarQuerySchema);
    return listCalendar(ctx, query);
  });
}
