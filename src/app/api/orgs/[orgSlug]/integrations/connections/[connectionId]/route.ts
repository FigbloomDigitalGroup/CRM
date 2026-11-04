import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { disconnectConnection, updateConnectionSettings } from "@/services/oauthConnectionService";

const SettingsSchema = z.strictObject({
  /** Which calendar is used for meetings (a calendar id the provider listed). */
  calendarId: z.string().max(300).nullable().optional(),
  /** Mail from or to these addresses or domains is never synced. */
  excludedAddresses: z.array(z.string().max(200)).max(500).optional(),
  syncEnabled: z.boolean().optional(),
});

// Disconnects: revokes at the provider, wipes the tokens, stops the sync (FIG-1153).
export async function DELETE(_request: Request, { params }: { params: Promise<{ orgSlug: string; connectionId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, connectionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return disconnectConnection(ctx, connectionId);
  });
}

// The calendar to use, the mail exclusion list, the sync switch.
export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string; connectionId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, connectionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SettingsSchema);
    return updateConnectionSettings(ctx, connectionId, body);
  });
}
