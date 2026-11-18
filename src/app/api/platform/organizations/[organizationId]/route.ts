import { handleRoute } from "@/app/api/_lib/handleRoute";
import { NotFoundError } from "@/auth/errors";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { getOrganizationDetail } from "@/services/platformOrganizationService";

/** One organisation (PL4): operational counts, owner contact, lifecycle trail, data requests, recent audit. No customer data. FIG-1136. */
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.view");
    const { organizationId } = await params;
    const detail = await getOrganizationDetail(organizationId);
    if (!detail) throw new NotFoundError("Organization", organizationId);
    return detail;
  });
}
