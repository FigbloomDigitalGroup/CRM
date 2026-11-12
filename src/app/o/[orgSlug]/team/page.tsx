import { resolveRequestContext } from "@/auth/requestContext";
import { TeamScreen } from "@/ui/screens/team/TeamScreen";

/**
 * P2-15: the Team page. The page is only the frame; the screen reads the team API, which answers Management and refuses everyone else with the
 * explained no-access state (the screen shows the same state before asking).
 */
export default async function TeamPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug); // a person outside the organisation is turned away here
  return <TeamScreen />;
}
