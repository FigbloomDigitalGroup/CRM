import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { SupportWorkspace } from "@/ui/screens/support/SupportWorkspace";

/** FIG-1178: the Customer Support workspace, on demo data until B6.23 is decided and built. The screen explains no-access to everyone without the ticket permission. */
export default async function SupportPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  if (!demoScreensEnabled()) notFound();
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <SupportWorkspace />;
}
