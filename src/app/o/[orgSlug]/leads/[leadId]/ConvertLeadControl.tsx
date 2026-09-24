"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  id: string;
  name: string;
}

export function ConvertLeadControl({
  orgSlug,
  leadId,
  hasCompany,
  companies,
}: {
  orgSlug: string;
  leadId: string;
  hasCompany: boolean;
  companies: Option[];
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/leads/${leadId}/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: hasCompany ? undefined : companyId,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to convert lead.");
      router.push(`/o/${orgSlug}/deals/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert lead.");
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleConvert}>
      {!hasCompany && (
        <label>
          Company (required to convert -- this lead has none attached)
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
          >
            {companies.length === 0 && <option value="">(none available)</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button
        type="submit"
        disabled={submitting || (!hasCompany && !companyId)}
      >
        {submitting ? "Converting..." : "Convert to deal"}
      </button>
    </form>
  );
}
