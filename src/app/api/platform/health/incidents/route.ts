import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requireRecentVerification } from "@/services/platformAdminService";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { createIncident, listIncidents } from "@/services/platformHealthService";

export async function GET() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.console.view");
    return { items: await listIncidents() };
  });
}

const Body = z.strictObject({
  component: z.string({ error: "component is required." }),
  severity: z.string({ error: "severity is required." }),
  title: z.string({ error: "title is required." }),
  note: z.string().optional(),
});

/** Opens an incident marker on the health page. Audited. FIG-1139. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.health.manage");
    await requireRecentVerification(platform);
    return createIncident(platform, await parseJsonBody(request, Body), request.headers.get("x-request-id"));
  });
}
