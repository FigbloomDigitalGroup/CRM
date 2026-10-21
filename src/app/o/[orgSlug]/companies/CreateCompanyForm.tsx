"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";
import { IconPlus } from "../_shared/icons";
import { initialsFor } from "../_shared/accountCapabilities";

export function CreateCompanyForm({
  orgSlug,
  lifecycleStates,
  owners = [],
  defaultOwnerMembershipId = "",
}: {
  orgSlug: string;
  lifecycleStates: { id: string; name: string }[];
  /** Only passed for people who may reassign; everyone else's new company is simply theirs. */
  owners?: { membershipId: string; userName: string; roleName: string }[];
  defaultOwnerMembershipId?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [lifecycleStateId, setLifecycleStateId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
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
      const res = await fetch(`/api/orgs/${orgSlug}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          industry: industry || undefined,
          lifecycleStateId: lifecycleStateId || undefined,
          email: email || undefined,
          phone: phone || undefined,
          website: website || undefined,
          ownerMembershipId:
            canChooseOwner && ownerMembershipId !== defaultOwnerMembershipId
              ? ownerMembershipId
              : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create company.");

      setCreated(body.company?.name ?? name);
      if (body.possibleDuplicates?.length) {
        setDuplicateWarning(
          `Heads up: ${body.possibleDuplicates.length} similar compan${body.possibleDuplicates.length === 1 ? "y" : "ies"} already exist (created anyway) -- ` +
            body.possibleDuplicates
              .map((d: { name: string }) => d.name)
              .join(", "),
        );
      }
      setName("");
      setIndustry("");
      setLifecycleStateId("");
      setEmail("");
      setPhone("");
      setWebsite("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company.");
    } finally {
      setSubmitting(false);
    }
  }

  const lifecycleOptions: ComboOption[] = [
    { value: "", label: "(none)" },
    ...lifecycleStates.map((s) => ({ value: s.id, label: s.name })),
  ];
  const ownerOptions: ComboOption[] = owners.map((o) => ({
    value: o.membershipId,
    label: o.userName,
    sublabel: o.roleName,
    avatarLabel: initialsFor(o.userName),
  }));

  return (
    <form className="stack deal-form" onSubmit={handleSubmit}>
      <div className="form-section">Company</div>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Industry
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
      </label>
      <label>
        Lifecycle
        <Combobox
          value={lifecycleStateId}
          options={lifecycleOptions}
          onChange={setLifecycleStateId}
          width={300}
        />
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
      <label>
        Website
        <input value={website} onChange={(e) => setWebsite(e.target.value)} />
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
        <p className="form-hint">You will be the owner of this company.</p>
      )}

      {created && !error && <p className="form-success">Added {created}.</p>}
      {duplicateWarning && <p className="warning">{duplicateWarning}</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn-block" disabled={submitting || !name.trim()}>
        <IconPlus />
        {submitting ? "Creating..." : "Create company"}
      </button>
    </form>
  );
}
