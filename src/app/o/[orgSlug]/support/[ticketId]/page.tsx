import { resolveRequestContext } from "@/auth/requestContext";
import { TicketDetail } from "@/ui/screens/support/TicketDetail";

/** FIG-1178: one support ticket. */
export default async function TicketPage({ params }: { params: Promise<{ orgSlug: string; ticketId: string }> }) {
  const { orgSlug, ticketId } = await params;
  await resolveRequestContext(orgSlug);
  return <TicketDetail ticketId={ticketId} />;
}
