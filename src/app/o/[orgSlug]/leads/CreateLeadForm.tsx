"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";

interface Option {
  id: string;
  name: string;
}

export function CreateLeadForm({
  orgSlug,
  leadStatuses,
  leadSources,
  companies,
  contacts,
}: {
  orgSlug: string;
  leadStatuses: Option[];
  leadSources: Option[];
  companies: Option[];
  contacts: Option[];
}) {
  const router = useRouter();
  const [leadStatusId, setLeadStatusId] = useState(leadStatuses[0]?.id ?? "");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [temperature, setTemperature] = useState<"HOT" | "WARM" | "COLD">(
    "WARM",
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDuplicateWarning(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadStatusId,
          leadSourceId: leadSourceId || undefined,
          companyId: companyId || undefined,
          contactId: contactId || undefined,
          temperature,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create lead.");

      if (body.possibleDuplicates?.length) {
        setDuplicateWarning(
          `Heads up: ${body.possibleDuplicates.length} open lead(s) already exist for this company (created anyway).`,
        );
      }
      setCompanyId("");
      setContactId("");
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead.");
    } finally {
      setSubmitting(false);
    }
  }

  const leadStatusOptions: ComboOption[] = leadStatuses.map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const leadSourceOptions: ComboOption[] = [
    { value: "", label: "(unknown)" },
    ...leadSources.map((s) => ({ value: s.id, label: s.name })),
  ];
  const companyOptions: ComboOption[] = [
    { value: "", label: "(none)" },
    ...companies.map((c) => ({ value: c.id, label: c.name })),
  ];
  const contactOptions: ComboOption[] = [
    { value: "", label: "(none)" },
    ...contacts.map((c) => ({ value: c.id, label: c.name })),
  ];
  const temperatureOptions: ComboOption[] = [
    { value: "HOT", label: "Hot" },
    { value: "WARM", label: "Warm" },
    { value: "COLD", label: "Cold" },
  ];

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Status
        <Combobox value={leadStatusId} options={leadStatusOptions} onChange={setLeadStatusId} />
      </label>
      <label>
        Source
        <Combobox value={leadSourceId} options={leadSourceOptions} onChange={setLeadSourceId} />
      </label>
      <label>
        Company
        <Combobox value={companyId} options={companyOptions} onChange={setCompanyId} />
      </label>
      <label>
        Contact
        <Combobox value={contactId} options={contactOptions} onChange={setContactId} />
      </label>
      <label>
        Temperature
        <Combobox
          value={temperature}
          options={temperatureOptions}
          onChange={(v) => setTemperature(v as "HOT" | "WARM" | "COLD")}
        />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {duplicateWarning && <p className="warning">{duplicateWarning}</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Creating..." : "Create lead"}
      </button>
    </form>
  );
}
