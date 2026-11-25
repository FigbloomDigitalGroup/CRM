import { Suspense } from "react";
import { resolveRequestContext } from "@/auth/requestContext";
import { NewInvoiceButton } from "@/ui/screens/invoices/NewInvoiceButton";
import { InvoicesScreen } from "@/ui/screens/invoices/InvoicesScreen";

/**
 * UC-R7 (FIG-1785): the Invoices page. The page is only the frame; the screen decides what a role may see (no access without `invoices.view`,
 * no balances or payments without `finance.view.payments`) and the invoice API enforces it again. UC-R2 adds the sidebar entry.
 */
export default async function InvoicesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug); // a person outside the organisation is turned away here
  return (
    <Suspense fallback={null}>
      <InvoicesScreen newInvoiceSlot={<NewInvoiceButton />} />
    </Suspense>
  );
}
