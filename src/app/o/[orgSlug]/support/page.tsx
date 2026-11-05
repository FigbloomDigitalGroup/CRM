import { resolveRequestContext } from "@/auth/requestContext";
import { SupportWorkspace } from "@/ui/screens/support/SupportWorkspace";

/** FIG-1178: the Customer Support workspace (FIG-1155). The screen explains no-access to everyone without the ticket permission. */
export default async function SupportPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <SupportWorkspace />;
}
