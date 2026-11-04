import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { getMailRecordCard } from "@/services/mailService";

// The record beside a message, with deal value, margin and payments masked for the person looking (not the sender).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "communication.group");
    const query = parseQueryParams(new URL(request.url).searchParams, z.object({ dealId: z.string().optional(), companyId: z.string().optional(), leadId: z.string().optional(), contactId: z.string().optional() }));
    return getMailRecordCard(ctx, query);
  });
}
