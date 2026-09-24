"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  id: string;
  name: string;
}

export function CreateDealForm({
  orgSlug,
  companies,
  contacts,
  services,
  pipelineStages,
}: {
  orgSlug: string;
  companies: Option[];
  contacts: Option[];
  services: Option[];
  pipelineStages: Option[];
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [pipelineStageId, setPipelineStageId] = useState(
    pipelineStages[0]?.id ?? "",
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

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Company
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          required
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Primary contact
        <select
          value={primaryContactId}
          onChange={(e) => setPrimaryContactId(e.target.value)}
        >
          <option value="">(none)</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Service
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">(unspecified)</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stage
        <select
          value={pipelineStageId}
          onChange={(e) => setPipelineStageId(e.target.value)}
          required
        >
          {pipelineStages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label>
        Currency
        <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </label>
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
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting || !companyId}>
        {submitting ? "Creating..." : "Create deal"}
      </button>
    </form>
  );
}
