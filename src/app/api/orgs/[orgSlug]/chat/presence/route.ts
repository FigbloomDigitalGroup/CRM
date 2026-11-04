import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { heartbeat } from "@/services/chatRealtimeService";

const Heartbeat = z.strictObject({ status: z.enum(["ONLINE", "AWAY"]).optional() });

// The heartbeat: online for the next minute.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const text = await request.text();
    const body = text.trim() ? await parseJsonBody(new Request(request.url, { method: "POST", body: text, headers: { "content-type": "application/json" } }), Heartbeat) : {};
    return heartbeat(ctx, (body as { status?: "ONLINE" | "AWAY" }).status ?? "ONLINE");
  });
}
