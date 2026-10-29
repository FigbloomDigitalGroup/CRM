import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { ChatWorkspace } from "@/ui/screens/communication";

/** Chat (F6.21, FIG-1379), V1.1, on demo data until B6.24 to B6.27 is wired (docs/RESTRUCTURE_LOG.md). The screen explains no-access to roles that may not use it. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <ChatWorkspace />;
}
