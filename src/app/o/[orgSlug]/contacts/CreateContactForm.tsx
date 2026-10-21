"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";
import { IconPlus } from "../_shared/icons";
import { initialsFor } from "../_shared/accountCapabilities";

export function CreateContactForm({
  orgSlug,
  companies,
  owners = [],
  defaultOwnerMembershipId = "",
}: {
  orgSlug: string;
  companies: { id: string; name: string }[];
  /** Only passed for people who may reassign; everyone else's new contact is simply theirs. */
  owners?: { membershipId: string; userName: string; roleName: string }[];
  defaultOwnerMembershipId?: string;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const canChooseOwner = owners.length > 0;
  const [ownerMembershipId, setOwnerMembershipId] = useState(
    owners.some((o) => o.membershipId === defaultOwnerMembershipId)
      ? defaultOwnerMembershipId
      : (owners[0]?.membershipId ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDuplicateWarning(null);
    setCreated(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName: lastName || undefined,
          companyId: companyId || undefined,
          jobTitle: jobTitle || undefined,
          email: email || undefined,
          phone: phone || undefined,
          ownerMembershipId:
            canChooseOwner && ownerMembershipId !== defaultOwnerMembershipId
              ? ownerMembershipId
              : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create contact.");

      setCreated(`${firstName} ${lastName}`.trim());
      if (body.possibleDuplicates?.length) {
        setDuplicateWarning(
          `Heads up: ${body.possibleDuplicates.length} contact(s) already share this email/phone (created anyway).`,
        );
      }
      setFirstName("");
      setLastName("");
      setCompanyId("");
      setJobTitle("");
      setEmail("");
      setPhone("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create contact.");
    } finally {
      setSubmitting(false);
    }
  }

  const companyOptions: ComboOption[] = [
    { value: "", label: "(none / standalone contact)" },
    ...companies.map((c) => ({ value: c.id, label: c.name })),
  ];
  const ownerOptions: ComboOption[] = owners.map((o) => ({
    value: o.membershipId,
    label: o.userName,
    sublabel: o.roleName,
    avatarLabel: initialsFor(o.userName),
  }));

  return (
    <form className="stack deal-form" onSubmit={handleSubmit}>
      <div className="form-section">Person</div>
      <div className="form-row">
        <label className="grow">
          First name
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label className="grow">
          Last name
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
      </div>
      {companies.length > 0 && (
        <label>
          Company
          <Combobox
            value={companyId}
            options={companyOptions}
            onChange={setCompanyId}
            width={300}
          />
        </label>
      )}
      <label>
        Job title
        <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </label>

      <div className="form-section">Contact details</div>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>

      <div className="form-section">Ownership</div>
      {canChooseOwner ? (
        <label>
          Owner
          <Combobox
            value={ownerMembershipId}
            options={ownerOptions}
            onChange={setOwnerMembershipId}
            width={300}
          />
        </label>
      ) : (
        <p className="form-hint">You will be the owner of this contact.</p>
      )}

      {created && !error && <p className="form-success">Added {created}.</p>}
      {duplicateWarning && <p className="warning">{duplicateWarning}</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn-block" disabled={submitting || !firstName.trim()}>
        <IconPlus />
        {submitting ? "Creating..." : "Create contact"}
      </button>
    </form>
  );
}
