"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Member {
  membershipId: string;
  userName: string;
  roleName: string;
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

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newOwnerMembershipId = e.target.value;
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
      <select value={value} onChange={handleChange} disabled={submitting}>
        {members.map((m) => (
          <option key={m.membershipId} value={m.membershipId}>
            {m.userName} ({m.roleName})
          </option>
        ))}
      </select>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
