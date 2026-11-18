import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { endEnrollment } from "@/services/followUpService";

// end an enrolment (FIG-1150). Needs access to the lead or deal it is on.
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; enrollmentId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, enrollmentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return endEnrollment(ctx, enrollmentId);
  });
}
