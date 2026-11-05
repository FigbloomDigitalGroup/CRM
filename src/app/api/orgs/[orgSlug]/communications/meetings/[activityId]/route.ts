import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { cancelMeeting, rescheduleMeeting } from "@/services/meetingService";

type P = { params: Promise<{ orgSlug: string; activityId: string }> };

export async function PATCH(request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, activityId } = await params;
    const ctx = await resolveGatedContext(orgSlug, "communication.group");
    const body = await parseJsonBody(request, z.strictObject({ start: z.string().optional(), end: z.string().optional(), title: z.string().min(1).max(200).optional() }));
    return rescheduleMeeting(ctx, activityId, body);
  });
}

export async function DELETE(_request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, activityId } = await params;
    return cancelMeeting(await resolveGatedContext(orgSlug, "communication.group"), activityId);
  });
}
