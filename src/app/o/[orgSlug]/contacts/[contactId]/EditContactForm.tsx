"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ContactFields {
  id: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export function EditContactForm({
  orgSlug,
  contact,
}: {
  orgSlug: string;
  contact: ContactFields;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName ?? "",
    jobTitle: contact.jobTitle ?? "",
    department: contact.department ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    notes: contact.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update contact.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update contact.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        First name
        <input
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          required
        />
      </label>
      <label>
        Last name
        <input
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
        />
      </label>
      <label>
        Job title
        <input
          value={form.jobTitle}
          onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
        />
      </label>
      <label>
        Department
        <input
          value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })}
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
