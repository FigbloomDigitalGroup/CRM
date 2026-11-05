import { resolveRequestContext } from "@/auth/requestContext";
import { ChatWorkspace } from "@/ui/screens/communication";

/** chat (V1.1), on the real API. The screen explains no-access and the V1.1 release gate itself. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <ChatWorkspace />;
}
