import { hasPermission } from "@/auth/context";
import { resolveRequestContext } from "@/auth/requestContext";
import { recordPageView } from "@/services/pageViewService";
import { buildRoleMatrix } from "@/ui/screens/settings/matrix";
import { SettingsScreen } from "@/ui/screens/settings/SettingsScreen";

/**
 * M9 (F4.04 to F4.09): Settings. The page is only the frame; every section is a screen on `@/ui` that reads and writes through the API, and a role
 * that may not change settings gets the explained no-access card from the screen. The role matrix is built here from the seed (the approved matrix),
 * only for a reader who may change configuration, and handed to the Security section as read-only data. The files beside this page (CatalogEditor,
 * MembersTable and the other forms) are the pre-redesign settings; nothing renders them any more.
 */
export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "settings");
  return <SettingsScreen matrix={hasPermission(ctx, "configuration.manage") ? buildRoleMatrix() : null} />;
}
