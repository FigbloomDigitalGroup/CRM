import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { VideoConference } from "@/ui/screens/communication";

/** Video Conference (F6.23, FIG-1381), V1.1, on demo data until FIG-808 and FIG-1153 is wired (docs/RESTRUCTURE_LOG.md). The screen explains no-access to roles that may not use it. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <VideoConference />;
}
