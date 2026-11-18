import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createFromSlot, listCalendar } from "@/services/calendarService";

// Tasks and calls/meetings for the month/week/day/list calendar (FIG-794, FIG-1039, B2.10).
// Either an explicit window (`from` and `to`) or a `view` around a `date` in the viewer's own
// time zone. `membershipId` is a member id or "all"; default is the caller; the team filter
// answers with whether the caller may use it and why not.
const CalendarQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  view: z.enum(["month", "week", "day", "list"]).optional(),
  date: z.string().optional(),
  membershipId: z.string().optional(),
});

const CreateFromSlotSchema = z.strictObject({
  kind: z.enum(["task", "activity"]),
  title: z.string({ error: "title is required." }),
  start: z.string({ error: "start is required." }),
  type: z.enum(["CALL", "MEETING"]).optional(),
  description: z.string().max(2000).optional(),
  assigneeMembershipId: z.string().optional(),
  link: z.strictObject({ type: z.enum(["Lead", "Deal", "Company", "Contact"]), id: z.string() }).optional(),
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

// Creates a task or a scheduled call/meeting from an empty slot, with its time and a link.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateFromSlotSchema);
    return createFromSlot(ctx, body);
  });
}
