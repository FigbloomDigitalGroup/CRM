import { resolveRequestContext } from "@/auth/requestContext";
import { PreferencesScreen, parseTab } from "@/ui/screens/preferences";

/**
 * Preferences (FIG-1103 to FIG-1105): every active member has their own, whatever their role, so the only check is that they belong to this
 * organisation. Each tab reads and writes the member's own rows through `/me/*`; nothing here can reach another person's settings.
 */
export default async function PreferencesPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  const { tab } = await searchParams;
  return <PreferencesScreen initialTab={parseTab(tab)} />;
}
