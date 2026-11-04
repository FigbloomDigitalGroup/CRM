import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { resolveRequestContext } from "@/auth/requestContext";
import { scheduleMeeting } from "@/services/meetingService";

const MeetingSchema = z.strictObject({
  title: z.string().min(1).max(200),
  start: z.string(),
  end: z.string().optional(),
  description: z.string().max(5000).optional(),
  attendees: z.array(z.string()).max(50).optional(),
  withVideo: z.boolean().optional(),
  link: z.strictObject({ type: z.enum(["Lead", "Deal", "Company", "Contact"]), id: z.string() }),
  followUp: z.strictObject({ title: z.string().min(1).max(200), dueAt: z.string().optional() }).optional(),
});

// Schedules a meeting from a record in the connected calendar, with invites and an optional Meet or Teams link (FIG-808).
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MeetingSchema);
    return withIdempotency(ctx, request, body, () => scheduleMeeting(ctx, body));
  });
}
