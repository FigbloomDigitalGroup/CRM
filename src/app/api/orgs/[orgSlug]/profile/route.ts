import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getOrganizationProfile,
  updateOrganizationProfile,
} from "@/services/organizationProfileService";

/**
 * Only shape-level (type-correctness), not the deeper rules --
 * organizationProfileService.ts's own `validate()` already covers the IANA
 * timezone check, currency/time format regexes, and the working-hours
 * start-before-end rule, and stays the single source of truth for those
 * since `scripts/provision-organization.ts` and other callers go through
 * the service directly, not this route.
 */
const UpdateProfileSchema = z.object({
  name: z.string().optional(),
  timezone: z.string().optional(),
  defaultCurrency: z.string().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  workingDays: z.array(z.string()).optional(),
  workingHoursStart: z.string().nullable().optional(),
  workingHoursEnd: z.string().nullable().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getOrganizationProfile(ctx);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateProfileSchema);
    return updateOrganizationProfile(ctx, body);
  });
}
