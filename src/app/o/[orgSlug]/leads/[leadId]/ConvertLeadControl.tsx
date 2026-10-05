"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  id: string;
  name: string;
}

/** FIG-601: conversion no longer requires an existing company -- one can be created inline, and an optional contact too. */
export function ConvertLeadControl({
  orgSlug,
  leadId,
  hasCompany,
  hasContact,
  companies,
}: {
  orgSlug: string;
  leadId: string;
  hasCompany: boolean;
  hasContact: boolean;
  companies: Option[];
}) {
  const router = useRouter();
  const [companyMode, setCompanyMode] = useState<"existing" | "new">(
    companies.length > 0 ? "existing" : "new",
  );
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [addContact, setAddContact] = useState(false);
  const [newContactFirstName, setNewContactFirstName] = useState("");
  const [newContactLastName, setNewContactLastName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    hasCompany ||
    (companyMode === "existing" ? Boolean(companyId) : Boolean(newCompanyName.trim()));

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
            companyId: hasCompany || companyMode !== "existing" ? undefined : companyId,
            newCompany:
              !hasCompany && companyMode === "new"
                ? { name: newCompanyName.trim() }
                : undefined,
            newContact:
              !hasContact && addContact
                ? {
                    firstName: newContactFirstName.trim(),
                    lastName: newContactLastName.trim() || undefined,
                    email: newContactEmail.trim() || undefined,
                    phone: newContactPhone.trim() || undefined,
                  }
                : undefined,
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
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <label>
              <input
                type="radio"
                checked={companyMode === "existing"}
                disabled={companies.length === 0}
                onChange={() => setCompanyMode("existing")}
              />{" "}
              Use an existing company
            </label>
            <label>
              <input
                type="radio"
                checked={companyMode === "new"}
                onChange={() => setCompanyMode("new")}
              />{" "}
              Create a new company
            </label>
          </div>
          {companyMode === "existing" ? (
            <label>
              Company
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
          ) : (
            <label>
              New company name
              <input
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                required
              />
            </label>
          )}
        </>
      )}

      {!hasContact && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={addContact}
              onChange={(e) => setAddContact(e.target.checked)}
            />
            Also add a contact for this deal
          </label>
          {addContact && (
            <>
              <label>
                First name
                <input
                  value={newContactFirstName}
                  onChange={(e) => setNewContactFirstName(e.target.value)}
                  required
                />
              </label>
              <label>
                Last name
                <input
                  value={newContactLastName}
                  onChange={(e) => setNewContactLastName(e.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                />
              </label>
              <label>
                Phone
                <input
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                />
              </label>
            </>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
      <button
        type="submit"
        disabled={
          submitting || !canSubmit || (addContact && !newContactFirstName.trim())
        }
      >
        {submitting ? "Converting..." : "Convert to deal"}
      </button>
    </form>
  );
}
