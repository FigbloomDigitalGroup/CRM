import { resolveRequestContext } from "@/auth/requestContext";
import { HelpCentre } from "@/ui/screens/palette/HelpCentre";

/** What's new (X3, FIG-1172). */
export default async function WhatsNewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <HelpCentre orgSlug={orgSlug} view="news" />;
}
