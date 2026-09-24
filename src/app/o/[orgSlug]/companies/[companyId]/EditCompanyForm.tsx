"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface CompanyFields {
  id: string;
  name: string;
  industry: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
}

export function EditCompanyForm({
  orgSlug,
  company,
}: {
  orgSlug: string;
  company: CompanyFields;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: company.name,
    industry: company.industry ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    website: company.website ?? "",
    notes: company.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update company.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update company.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </label>
      <label>
        Industry
        <input
          value={form.industry}
          onChange={(e) => setForm({ ...form, industry: e.target.value })}
        />
      </label>
      <label>
        Email
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </label>
      <label>
        Phone
        <input
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </label>
      <label>
        Website
        <input
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
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
