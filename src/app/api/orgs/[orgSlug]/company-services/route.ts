import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { ValidationError } from "@/auth/errors";
import {
  addCompanyService,
  listCompanyServices,
} from "@/services/companyServiceLinkService";

const AddCompanyServiceSchema = z.object({
  companyId: requiredString("companyId is required."),
  serviceId: requiredString("serviceId is required."),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  // Deliberately strings, not z.coerce.date() -- the service does its own
  // new Date() conversion (companyServiceLinkService.ts).
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    if (!companyId) {
      throw new ValidationError("companyId is required.");
    }
    return listCompanyServices(ctx, companyId);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AddCompanyServiceSchema);
    return addCompanyService(ctx, body);
  });
}
