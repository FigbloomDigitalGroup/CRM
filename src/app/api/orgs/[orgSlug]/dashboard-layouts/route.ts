import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getDashboardLayout, saveDashboardLayout } from "@/services/dashboardLayoutService";

const LayoutSchema = z.strictObject({
  /** Which role's home: management, sales, delivery, finance, technical or marketing. */
  kind: z.string(),
  /** The widgets in order, each shown or hidden. null puts the home back to its default. Hiding and reordering only. */
  widgets: z.array(z.strictObject({ id: z.string(), visible: z.boolean() })).nullable(),
});

// UC-W1 (FIG-1802): which widgets a role's home shows and in what order. Any member reads their own home's layout; Management reads any and writes (PUT, idempotent).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getDashboardLayout(ctx, new URL(request.url).searchParams.get("kind"));
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return saveDashboardLayout(ctx, await parseJsonBody(request, LayoutSchema));
  });
}
