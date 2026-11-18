import { resolveRequestContext } from "@/auth/requestContext";
import { ConversationsScreen } from "@/ui/screens/engage/ConversationsScreen";

/**
 * F3.04: the Conversations hub and the Needs-linking queue. The page is only the frame: it resolves the organisation (so a signed-out or
 * foreign visitor is turned away) and hands over to the screen, which reads the API. Roles that may not read conversations get the API's
 * explained "no access". There is no page-view label for this page (the label list belongs to the usage metric).
 */
export default async function ConversationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <ConversationsScreen />;
}
