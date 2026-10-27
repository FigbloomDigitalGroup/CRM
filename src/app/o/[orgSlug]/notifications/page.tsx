import { resolveRequestContext } from "@/auth/requestContext";
import { NotificationCentre } from "@/ui/screens/home/Notifications";

/** The notification centre (G3). Reads `GET /api/orgs/{org}/notifications`, which already drops anything about a record the member can no longer open. */
export default async function NotificationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <NotificationCentre />;
}
