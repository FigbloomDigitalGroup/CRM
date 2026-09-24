"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateCompanyForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDuplicateWarning(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          industry: industry || undefined,
          email: email || undefined,
          phone: phone || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create company.");

      if (body.possibleDuplicates?.length) {
        setDuplicateWarning(
          `Heads up: ${body.possibleDuplicates.length} similar compan${body.possibleDuplicates.length === 1 ? "y" : "ies"} already exist (created anyway) -- ` +
            body.possibleDuplicates
              .map((d: { name: string }) => d.name)
              .join(", "),
        );
      }
      setName("");
      setIndustry("");
      setEmail("");
      setPhone("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create company.",
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label>
        Industry
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {duplicateWarning && <p className="warning">{duplicateWarning}</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Creating..." : "Create company"}
      </button>
    </form>
  );
}
