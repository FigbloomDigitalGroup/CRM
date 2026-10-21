"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "./Combobox";

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

/**
 * Inline owner picker for a company or contact row. Only rendered for people
 * who may reassign (Management); the PATCH is checked again on the server.
 */
export function OwnerControl({
  orgSlug,
  basePath,
  currentOwnerMembershipId,
  members,
  label,
}: {
  orgSlug: string;
  /** e.g. `companies/<id>` */
  basePath: string;
  currentOwnerMembershipId: string | null;
  members: Member[];
  label: string;
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

  async function handleChange(next: string) {
    setValue(next);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/${basePath}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerMembershipId: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed to reassign ${label}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to reassign ${label}.`);
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
        placeholder="Unassigned - Assign"
        width={240}
        ariaLabel={`Reassign ${label}`}
      />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
