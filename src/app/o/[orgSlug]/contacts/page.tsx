import { schedulePageView } from "@/services/pageViewService";
import { ContactsScreen } from "@/ui/screens/contacts/ContactsScreen";

/**
 * F3.02: the contacts list. The page is only the frame: it records the view and hands over to the screen, which reads the API. A role the API
 * refuses gets the explained "no access".
 */
export default async function ContactsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await schedulePageView(orgSlug, "contacts");
  return <ContactsScreen />;
}
