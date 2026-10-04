"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = "ACTIVE" | "COMPLETED" | "CANCELLED";

interface CompanyServiceRow {
  id: string;
  serviceId: string;
  serviceName: string;
  status: Status;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}

interface ServiceOption {
  id: string;
  name: string;
}

export function CompanyServicesSection({
  orgSlug,
  companyId,
  services,
  catalog,
  canManage,
}: {
  orgSlug: string;
  companyId: string;
  services: CompanyServiceRow[];
  catalog: ServiceOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(catalog[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/company-services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          serviceId,
          startDate: startDate || undefined,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add service.");
      setStartDate("");
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add service.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(companyServiceId: string, status: Status) {
    setUpdatingId(companyServiceId);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/company-services/${companyServiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          endDate: status === "ACTIVE" ? null : new Date().toISOString().slice(0, 10),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update service.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update service.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="card">
      <strong>Services</strong>
      {services.length === 0 ? (
        <p className="who">No services recorded for this company yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>Start</th>
              <th>End</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td>{s.serviceName}</td>
                <td>
                  {canManage ? (
                    <select
                      value={s.status}
                      disabled={updatingId === s.id}
                      onChange={(e) => handleStatusChange(s.id, e.target.value as Status)}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  ) : (
                    s.status
                  )}
                </td>
                <td>{s.startDate ? new Date(s.startDate).toLocaleDateString() : "--"}</td>
                <td>{s.endDate ? new Date(s.endDate).toLocaleDateString() : "--"}</td>
                <td>{s.notes ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && catalog.length > 0 && (
        <>
          <h3>Add a service</h3>
          <form className="stack" onSubmit={handleAdd}>
            <label>
              Service
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {catalog.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add service"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
