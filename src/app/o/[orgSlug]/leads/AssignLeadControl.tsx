"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";

interface Member {
  membershipId: string;
  userName: string;
  roleName: string;
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function AssignLeadControl({
  orgSlug,
  leadId,
  currentOwnerMembershipId,
  members,
}: {
  orgSlug: string;
  leadId: string;
  currentOwnerMembershipId: string | null;
  members: Member[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentOwnerMembershipId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const options: ComboOption[] = members.map((m) => ({
    value: m.membershipId,
    label: m.userName,
    sublabel: m.roleName,
    avatarLabel: initialsFor(m.userName),
  }));

  async function handleChange(newOwnerMembershipId: string) {
    setValue(newOwnerMembershipId);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerMembershipId: newOwnerMembershipId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to reassign lead.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reassign lead.");
      setValue(currentOwnerMembershipId ?? "");
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
        width={240}
        ariaLabel="Reassign lead"
      />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
