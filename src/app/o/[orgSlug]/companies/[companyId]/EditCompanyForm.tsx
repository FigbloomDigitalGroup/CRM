"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../../_shared/Combobox";
import { IconLock } from "../../_shared/icons";
import { initialsFor } from "../../_shared/accountCapabilities";
import type { CompanyOwner } from "../CompanyRefs";

export interface CompanyFields {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  lifecycleStateId: string | null;
  ownerMembershipId: string | null;
}

/**
 * One edit form for both the list's drawer and the detail page. Everyone
 * who may edit companies gets every detail field; the Owner field is a real
 * picker only for people who may reassign (Management) and a locked,
 * read-only line for everyone else. The server enforces the same rules.
 */
export function EditCompanyForm({
  orgSlug,
  company,
  lifecycleStates,
  owners,
  ownerName,
  canAssign,
  onCancel,
  onSaved,
  extraFooter,
}: {
  orgSlug: string;
  company: CompanyFields;
  lifecycleStates: { id: string; name: string }[];
  owners: CompanyOwner[];
  ownerName: string | null;
  canAssign: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
  extraFooter?: React.ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: company.name,
    industry: company.industry ?? "",
    website: company.website ?? "",
    location: company.location ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    notes: company.notes ?? "",
    lifecycleStateId: company.lifecycleStateId ?? "",
    ownerMembershipId: company.ownerMembershipId ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const lifecycleOptions: ComboOption[] = [
    { value: "", label: "(none)" },
    ...lifecycleStates.map((s) => ({ value: s.id, label: s.name })),
  ];
  const ownerOptions: ComboOption[] = owners.map((m) => ({
    value: m.membershipId,
    label: m.userName,
    sublabel: m.roleName,
    avatarLabel: initialsFor(m.userName),
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("A company needs a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ownerChanged =
        canAssign &&
        form.ownerMembershipId !== "" &&
        form.ownerMembershipId !== (company.ownerMembershipId ?? "");
      const res = await fetch(`/api/orgs/${orgSlug}/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          industry: form.industry,
          website: form.website,
          location: form.location,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
          lifecycleStateId: form.lifecycleStateId || null,
          ...(ownerChanged ? { ownerMembershipId: form.ownerMembershipId } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update company.");
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update company.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="lead-edit-form" onSubmit={handleSubmit}>
      <div className="lead-edit-body">
        <div className="lead-edit-field">
          <label htmlFor={`co-name-${company.id}`}>Company name</label>
          <input
            id={`co-name-${company.id}`}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div className="lead-edit-field">
          <label>Lifecycle</label>
          <Combobox
            value={form.lifecycleStateId}
            options={lifecycleOptions}
            onChange={(v) => setForm({ ...form, lifecycleStateId: v })}
            ariaLabel="Lifecycle"
            width={280}
          />
        </div>

        <div className="lead-edit-field">
          <label>Industry</label>
          <input
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
          />
        </div>

        <div className="lead-edit-pair">
          <div className="lead-edit-field">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="lead-edit-field">
            <label>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
        </div>

        <div className="lead-edit-pair">
          <div className="lead-edit-field">
            <label>Website</label>
            <input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </div>
          <div className="lead-edit-field">
            <label>Location</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
        </div>

        <div className="lead-edit-field">
          <label>Notes</label>
          <textarea
            value={form.notes}
            placeholder="Background, preferences, anything the team should know..."
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="lead-edit-field">
          <label>Owner</label>
          {canAssign ? (
            <>
              <Combobox
                value={form.ownerMembershipId}
                options={ownerOptions}
                onChange={(v) => setForm({ ...form, ownerMembershipId: v })}
                placeholder="Unassigned"
                ariaLabel="Owner"
                width={280}
              />
              <p className="lead-edit-help">
                Only people who can view and edit companies are listed.
              </p>
            </>
          ) : (
            <>
              <div className="lead-edit-locked">
                <span>{ownerName ?? "Unassigned"}</span>
                <IconLock />
              </div>
              <p className="lead-edit-help">Only Management can reassign companies.</p>
            </>
          )}
        </div>

        {error && <p className="error">{error}</p>}
      </div>

      <div className="lead-edit-footer">
        {extraFooter}
        <span className="lead-edit-footer-spacer" />
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}
