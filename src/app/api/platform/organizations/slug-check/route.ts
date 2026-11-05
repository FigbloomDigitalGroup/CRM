import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { checkSlug } from "@/services/platformOrganizationService";

/** Is this slug free, valid and not reserved? Suggests another when it is taken (PL3). FIG-1136. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.provision");
    const { slug } = parseQueryParams(new URL(request.url).searchParams, z.object({ slug: z.string({ error: "slug is required." }) }));
    return checkSlug(slug);
  });
}
