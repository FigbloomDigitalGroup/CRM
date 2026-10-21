"use client";

import { AccountDrawer } from "../_shared/AccountDrawer";
import { AccountRowActions, type AccountRowCaps } from "../_shared/AccountRowActions";
import { EditCompanyForm, type CompanyFields } from "./[companyId]/EditCompanyForm";
import { useCompanyRefs } from "./CompanyRefs";

/** Row actions for the companies list: edit drawer plus the shared row menu. */
export function CompanyRowActions({
  orgSlug,
  company,
  ownerName,
  caps,
}: {
  orgSlug: string;
  company: CompanyFields;
  ownerName: string | null;
  caps: AccountRowCaps;
}) {
  const refs = useCompanyRefs();
  return (
    <AccountRowActions
      orgSlug={orgSlug}
      noun="company"
      basePath={`companies/${company.id}`}
      detailHref={`/o/${orgSlug}/companies/${company.id}`}
      caps={caps}
      renderDrawer={({ onClose, footer }) => (
        <AccountDrawer heading="Edit company" subheading={company.name} onClose={onClose}>
          <EditCompanyForm
            orgSlug={orgSlug}
            company={company}
            lifecycleStates={refs.lifecycleStates}
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
