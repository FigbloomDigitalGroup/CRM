import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateCompanyService } from "@/services/companyServiceLinkService";

const UpdateCompanyServiceSchema = z.object({
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyServiceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyServiceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateCompanyServiceSchema);
    return updateCompanyService(ctx, companyServiceId, body);
  });
}
