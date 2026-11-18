import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getEnrollment } from "@/services/followUpService";

// One enrolment with its run log: every step, pause, resume and exit.
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; enrollmentId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, enrollmentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getEnrollment(ctx, enrollmentId);
  });
}
