"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  id: string;
  name: string;
}

interface PipelineStageOption extends Option {
  isWon: boolean;
  isLost: boolean;
}

interface DealFields {
  id: string;
  primaryContactId: string | null;
  serviceId: string | null;
  pipelineStageId: string;
  value: string;
  currency: string;
  expectedCloseDate: string;
  notes: string | null;
}

export function EditDealForm({
  orgSlug,
  deal,
  contacts,
  services,
  pipelineStages,
  lostReasons,
}: {
  orgSlug: string;
  deal: DealFields;
  contacts: Option[];
  services: Option[];
  pipelineStages: PipelineStageOption[];
  lostReasons: Option[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    primaryContactId: deal.primaryContactId ?? "",
    serviceId: deal.serviceId ?? "",
    pipelineStageId: deal.pipelineStageId,
    lostReasonId: "",
    value: deal.value,
    currency: deal.currency,
    expectedCloseDate: deal.expectedCloseDate,
    notes: deal.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedStage = pipelineStages.find(
    (s) => s.id === form.pipelineStageId,
  );
  const movingToLostStage = selectedStage?.isLost ?? false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryContactId: form.primaryContactId || null,
          serviceId: form.serviceId || null,
          pipelineStageId: form.pipelineStageId,
          lostReasonId: movingToLostStage
            ? form.lostReasonId || undefined
            : undefined,
          value: form.value || null,
          currency: form.currency,
          expectedCloseDate: form.expectedCloseDate || null,
          notes: form.notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update deal.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update deal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Stage
        <select
          value={form.pipelineStageId}
          onChange={(e) =>
            setForm({ ...form, pipelineStageId: e.target.value })
          }
        >
          {pipelineStages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {movingToLostStage && (
        <label>
          Lost reason
          <select
            value={form.lostReasonId}
            onChange={(e) =>
              setForm({ ...form, lostReasonId: e.target.value })
            }
            required
          >
            <option value="">(select a reason)</option>
            {lostReasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Primary contact
        <select
          value={form.primaryContactId}
          onChange={(e) =>
            setForm({ ...form, primaryContactId: e.target.value })
          }
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
        <select
          value={form.serviceId}
          onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
        >
          <option value="">(unspecified)</option>
          {services.map((s) => (
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
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
        />
      </label>
      <label>
        Currency
        <input
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
        />
      </label>
      <label>
        Expected close date
        <input
          type="date"
          value={form.expectedCloseDate}
          onChange={(e) =>
            setForm({ ...form, expectedCloseDate: e.target.value })
          }
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
