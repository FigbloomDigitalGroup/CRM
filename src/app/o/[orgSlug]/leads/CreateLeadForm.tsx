"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Status
        <select
          value={leadStatusId}
          onChange={(e) => setLeadStatusId(e.target.value)}
          required
        >
          {leadStatuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source
        <select
          value={leadSourceId}
          onChange={(e) => setLeadSourceId(e.target.value)}
        >
          <option value="">(unknown)</option>
          {leadSources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Company
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          <option value="">(none)</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Contact
        <select
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
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
        Temperature
        <select
          value={temperature}
          onChange={(e) =>
            setTemperature(e.target.value as "HOT" | "WARM" | "COLD")
          }
        >
          <option value="HOT">Hot</option>
          <option value="WARM">Warm</option>
          <option value="COLD">Cold</option>
        </select>
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
