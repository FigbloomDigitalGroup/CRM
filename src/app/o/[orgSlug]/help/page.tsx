import { resolveRequestContext } from "@/auth/requestContext";
import { HelpCentre } from "@/ui/screens/palette/HelpCentre";

/** The Help centre (X3, FIG-1172): open to every member of the organisation; it holds only guidance, no records. */
export default async function HelpPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <HelpCentre orgSlug={orgSlug} view="help" />;
}
