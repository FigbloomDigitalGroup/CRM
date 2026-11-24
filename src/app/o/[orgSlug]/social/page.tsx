import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { SocialWorkspace, socialScreensEnabled } from "@/ui/screens/social";

/** Social workspace (UC-S4 to UC-S6), on demo data: a 404 unless demo screens are switched on (preview build). The screen explains no-access itself. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!socialScreensEnabled()) notFound();
  return <SocialWorkspace />;
}
