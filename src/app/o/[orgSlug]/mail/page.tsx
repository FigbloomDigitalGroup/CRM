import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { MailWorkspace } from "@/ui/screens/communication";

/** Mail (F6.22, FIG-1380), V1.1, on demo data until FIG-806, FIG-807 and FIG-1153 is wired (docs/RESTRUCTURE_LOG.md). The screen explains no-access to roles that may not use it. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <MailWorkspace />;
}
