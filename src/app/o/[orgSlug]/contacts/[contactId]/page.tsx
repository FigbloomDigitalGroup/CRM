import { resolveRequestContext } from "@/auth/requestContext";
import { recordPageView } from "@/services/pageViewService";
import { ContactDetailScreen } from "@/ui/screens/contacts/ContactDetailScreen";

/** The contact page (F3.02): who they are, call and WhatsApp with the log prompt, conversations, tasks and the shared record extras. */
export default async function ContactDetailPage({ params }: { params: Promise<{ orgSlug: string; contactId: string }> }) {
  const { orgSlug, contactId } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "contacts_detail");
  return <ContactDetailScreen contactId={contactId} />;
}
