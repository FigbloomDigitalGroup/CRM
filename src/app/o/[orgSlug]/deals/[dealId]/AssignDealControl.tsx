"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../../_shared/Combobox";

interface Owner {
  membershipId: string;
  userName: string;
  roleName: string;
}

/**
 * Owner picker for the deal detail page. Only rendered for people allowed
 * to reassign deals (Management); everyone else sees the owner as plain
 * text. The server re-checks this and that the new owner can work deals.
 */
export function AssignDealControl({
  orgSlug,
  dealId,
  currentOwnerMembershipId,
  owners,
}: {
  orgSlug: string;
  dealId: string;
  currentOwnerMembershipId: string;
  owners: Owner[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentOwnerMembershipId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const options: ComboOption[] = owners.map((o) => ({
    value: o.membershipId,
    label: o.userName,
    sublabel: o.roleName,
    avatarLabel: o.userName.slice(0, 2).toUpperCase(),
  }));

  async function handleChange(next: string) {
    setValue(next);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/deals/${dealId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerMembershipId: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reassign deal.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reassign deal.");
      setValue(currentOwnerMembershipId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Combobox
        value={value}
        options={options}
        onChange={handleChange}
        disabled={submitting}
        width={260}
        ariaLabel="Reassign deal"
      />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
