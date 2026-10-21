"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";
import { IconPlus } from "../_shared/icons";

interface Option {
  id: string;
  name: string;
}

interface OwnerOption {
  membershipId: string;
  userName: string;
  roleName: string;
}

export function CreateDealForm({
  orgSlug,
  companies,
  contacts,
  services,
  pipelineStages,
  owners = [],
  defaultOwnerMembershipId = "",
}: {
  orgSlug: string;
  companies: Option[];
  contacts: Option[];
  services: Option[];
  pipelineStages: Option[];
  /** Only passed for people who can edit every deal; everyone else's new deal is simply theirs. */
  owners?: OwnerOption[];
  defaultOwnerMembershipId?: string;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [pipelineStageId, setPipelineStageId] = useState(
    pipelineStages[0]?.id ?? "",
  );
  const canChooseOwner = owners.length > 0;
  const [ownerMembershipId, setOwnerMembershipId] = useState(
    owners.some((o) => o.membershipId === defaultOwnerMembershipId)
      ? defaultOwnerMembershipId
      : (owners[0]?.membershipId ?? ""),
  );
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          primaryContactId: primaryContactId || undefined,
          serviceId: serviceId || undefined,
          pipelineStageId,
          ownerMembershipId:
            canChooseOwner && ownerMembershipId !== defaultOwnerMembershipId
              ? ownerMembershipId
              : undefined,
          value: value || undefined,
          currency,
          expectedCloseDate: expectedCloseDate || undefined,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create deal.");
      setNotes("");
      setValue("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deal.");
    } finally {
      setSubmitting(false);
    }
  }

  const companyOptions: ComboOption[] = companies.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const contactOptions: ComboOption[] = [
    { value: "", label: "(none)" },
    ...contacts.map((c) => ({ value: c.id, label: c.name })),
  ];
  const serviceOptions: ComboOption[] = [
    { value: "", label: "(unspecified)" },
    ...services.map((s) => ({ value: s.id, label: s.name })),
  ];
  const stageOptions: ComboOption[] = pipelineStages.map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const ownerOptions: ComboOption[] = owners.map((o) => ({
    value: o.membershipId,
    label: o.userName,
    sublabel: o.roleName,
    avatarLabel: o.userName.slice(0, 2).toUpperCase(),
  }));

  return (
    <form className="stack deal-form" onSubmit={handleSubmit}>
      <div className="form-section">Account</div>
      <label>
        Company
        <Combobox
          value={companyId}
          options={companyOptions}
          onChange={setCompanyId}
          placeholder="Choose a company"
          width={300}
        />
      </label>
      <label>
        Primary contact
        <Combobox
          value={primaryContactId}
          options={contactOptions}
          onChange={setPrimaryContactId}
          width={300}
        />
      </label>
      <label>
        Service
        <Combobox
          value={serviceId}
          options={serviceOptions}
          onChange={setServiceId}
          width={300}
        />
      </label>

      <div className="form-section">Deal</div>
      <label>
        Stage
        <Combobox
          value={pipelineStageId}
          options={stageOptions}
          onChange={setPipelineStageId}
          width={300}
        />
      </label>
      {canChooseOwner && (
        <label>
          Owner
          <Combobox
            value={ownerMembershipId}
            options={ownerOptions}
            onChange={setOwnerMembershipId}
            width={300}
          />
        </label>
      )}
      <div className="form-row">
        <label className="grow">
          Value
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="narrow">
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </label>
      </div>

      <div className="form-section">Timing &amp; notes</div>
      <label>
        Expected close date
        <input
          type="date"
          value={expectedCloseDate}
          onChange={(e) => setExpectedCloseDate(e.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea
          placeholder="Context, next steps..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn-block" disabled={submitting || !companyId}>
        <IconPlus />
        {submitting ? "Creating..." : "Create deal"}
      </button>
    </form>
  );
}
