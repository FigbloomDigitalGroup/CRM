"use client";

import { AccountDrawer } from "../_shared/AccountDrawer";
import { AccountRowActions, type AccountRowCaps } from "../_shared/AccountRowActions";
import { EditContactForm, type ContactFields } from "./[contactId]/EditContactForm";
import { useContactRefs } from "./ContactRefs";

/** Row actions for the contacts list: edit drawer plus the shared row menu. */
export function ContactRowActions({
  orgSlug,
  contact,
  ownerName,
  caps,
}: {
  orgSlug: string;
  contact: ContactFields;
  ownerName: string | null;
  caps: AccountRowCaps;
}) {
  const refs = useContactRefs();
  const fullName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  return (
    <AccountRowActions
      orgSlug={orgSlug}
      noun="contact"
      basePath={`contacts/${contact.id}`}
      detailHref={`/o/${orgSlug}/contacts/${contact.id}`}
      caps={caps}
      renderDrawer={({ onClose, footer }) => (
        <AccountDrawer heading="Edit contact" subheading={fullName} onClose={onClose}>
          <EditContactForm
            orgSlug={orgSlug}
            contact={contact}
            companies={refs.companies}
            owners={refs.owners}
            ownerName={ownerName}
            canAssign={caps.canReassign}
            onCancel={onClose}
            onSaved={onClose}
            extraFooter={footer}
          />
        </AccountDrawer>
      )}
    />
  );
}
