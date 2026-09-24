"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProposalStatus =
  | "DRAFT"
  | "SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

const STATUSES: ProposalStatus[] = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
];

interface Proposal {
  id: string;
  proposalNumber: string;
  status: ProposalStatus;
  amount: string | null;
  currency: string;
}

export function ProposalReferences({
  orgSlug,
  dealId,
  proposals,
  canManage,
}: {
  orgSlug: string;
  dealId: string;
  proposals: Proposal[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [proposalNumber, setProposalNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/deals/${dealId}/proposals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposalNumber,
            amount: amount || undefined,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add proposal.");
      setProposalNumber("");
      setAmount("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add proposal.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(proposalId: string, status: string) {
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/deals/${dealId}/proposals/${proposalId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.error ?? "Failed to update proposal status.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update proposal.",
      );
    }
  }

  return (
    <div className="card">
      <strong>Proposals</strong>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => (
            <tr key={p.id}>
              <td>{p.proposalNumber}</td>
              <td>{p.amount ? `${p.currency} ${p.amount}` : "--"}</td>
              <td>
                {canManage ? (
                  <select
                    value={p.status}
                    onChange={(e) => handleStatusChange(p.id, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="badge">{p.status}</span>
                )}
              </td>
            </tr>
          ))}
          {proposals.length === 0 && (
            <tr>
              <td colSpan={3}>No proposals recorded yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {canManage && (
        <form className="stack" onSubmit={handleCreate}>
          <label>
            Proposal number
            <input
              value={proposalNumber}
              onChange={(e) => setProposalNumber(e.target.value)}
              required
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Add proposal"}
          </button>
        </form>
      )}
    </div>
  );
}
