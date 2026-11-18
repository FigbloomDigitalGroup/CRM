import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ScheduleHealthResponseSchema } from "@/api/dto/jobs";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { getScheduleHealth } from "@/services/jobService";

// Scheduled job types and whether any has missed two runs (FIG-1066, B2.18).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(ScheduleHealthResponseSchema, { schedules: await getScheduleHealth(ctx) });
  });
}
