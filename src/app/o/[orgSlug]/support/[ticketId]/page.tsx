import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { TicketDetail } from "@/ui/screens/support/TicketDetail";

/** FIG-1178: one support ticket, on demo data. */
export default async function TicketPage({ params }: { params: Promise<{ orgSlug: string; ticketId: string }> }) {
  if (!demoScreensEnabled()) notFound();
  const { orgSlug, ticketId } = await params;
  await resolveRequestContext(orgSlug);
  return <TicketDetail ticketId={ticketId} />;
}
