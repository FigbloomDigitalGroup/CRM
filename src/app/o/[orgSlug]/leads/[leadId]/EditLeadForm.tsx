"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  id: string;
  name: string;
}

interface LeadFields {
  id: string;
  leadStatusId: string;
  leadSourceId: string | null;
  temperature: "HOT" | "WARM" | "COLD";
  notes: string | null;
  nextFollowUpAt: string;
}

export function EditLeadForm({
  orgSlug,
  lead,
  leadStatuses,
  leadSources,
}: {
  orgSlug: string;
  lead: LeadFields;
  leadStatuses: Option[];
  leadSources: Option[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    leadStatusId: lead.leadStatusId,
    leadSourceId: lead.leadSourceId ?? "",
    temperature: lead.temperature,
    notes: lead.notes ?? "",
    nextFollowUpAt: lead.nextFollowUpAt,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadStatusId: form.leadStatusId,
          leadSourceId: form.leadSourceId || null,
          temperature: form.temperature,
          notes: form.notes || null,
          nextFollowUpAt: form.nextFollowUpAt
            ? new Date(form.nextFollowUpAt).toISOString()
            : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update lead.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update lead.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Status
        <select
          value={form.leadStatusId}
          onChange={(e) => setForm({ ...form, leadStatusId: e.target.value })}
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
          value={form.leadSourceId}
          onChange={(e) => setForm({ ...form, leadSourceId: e.target.value })}
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
        Temperature
        <select
          value={form.temperature}
          onChange={(e) =>
            setForm({
              ...form,
              temperature: e.target.value as "HOT" | "WARM" | "COLD",
            })
          }
        >
          <option value="HOT">Hot</option>
          <option value="WARM">Warm</option>
          <option value="COLD">Cold</option>
        </select>
      </label>
      <label>
        Next follow-up
        <input
          type="datetime-local"
          value={form.nextFollowUpAt}
          onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
        />
      </label>
      <label>
        Notes
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
