"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../../_shared/Combobox";
import { IconLock } from "../../_shared/icons";
import { initialsFor } from "../../_shared/accountCapabilities";
import type { ContactOwner } from "../ContactRefs";

export interface ContactFields {
  id: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  companyId: string | null;
  /** Shown when the viewer cannot pick companies (no `companies.view`). */
  companyName: string | null;
  ownerMembershipId: string | null;
}

/**
 * One edit form for both the list's drawer and the detail page. Everyone
 * who may edit contacts gets every detail field; the company picker needs
 * `companies.view` (otherwise the company is shown read-only); the Owner
 * field is a real picker only for people who may reassign (Management).
 */
export function EditContactForm({
  orgSlug,
  contact,
  companies,
  owners,
  ownerName,
  canAssign,
  onCancel,
  onSaved,
  extraFooter,
}: {
  orgSlug: string;
  contact: ContactFields;
  companies: { id: string; name: string }[];
  owners: ContactOwner[];
  ownerName: string | null;
  canAssign: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
  extraFooter?: React.ReactNode;
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
    companyId: contact.companyId ?? "",
    ownerMembershipId: contact.ownerMembershipId ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canPickCompany = companies.length > 0;
  const companyOptions: ComboOption[] = [
    { value: "", label: "(none / standalone contact)" },
    ...companies.map((c) => ({ value: c.id, label: c.name })),
  ];
  // Keep a currently filed-under company (e.g. an archived one) selectable as the current value.
  if (
    contact.companyId &&
    contact.companyName &&
    !companies.some((c) => c.id === contact.companyId)
  ) {
    companyOptions.push({ value: contact.companyId, label: contact.companyName });
  }
  const ownerOptions: ComboOption[] = owners.map((m) => ({
    value: m.membershipId,
    label: m.userName,
    sublabel: m.roleName,
    avatarLabel: initialsFor(m.userName),
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim()) {
      setError("A contact needs a first name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ownerChanged =
        canAssign &&
        form.ownerMembershipId !== "" &&
        form.ownerMembershipId !== (contact.ownerMembershipId ?? "");
      const res = await fetch(`/api/orgs/${orgSlug}/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          jobTitle: form.jobTitle,
          department: form.department,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
          ...(canPickCompany ? { companyId: form.companyId || null } : {}),
          ...(ownerChanged ? { ownerMembershipId: form.ownerMembershipId } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update contact.");
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update contact.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="lead-edit-form" onSubmit={handleSubmit}>
      <div className="lead-edit-body">
        <div className="lead-edit-pair">
          <div className="lead-edit-field">
            <label>First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              required
            />
          </div>
          <div className="lead-edit-field">
            <label>Last name</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
        </div>

        <div className="lead-edit-field">
          <label>Company</label>
          {canPickCompany ? (
            <Combobox
              value={form.companyId}
              options={companyOptions}
              onChange={(v) => setForm({ ...form, companyId: v })}
              ariaLabel="Company"
              width={300}
            />
          ) : (
            <div className="lead-edit-locked">
              <span>{contact.companyName ?? "(standalone contact)"}</span>
              <IconLock />
            </div>
          )}
        </div>

        <div className="lead-edit-pair">
          <div className="lead-edit-field">
            <label>Job title</label>
            <input
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            />
          </div>
          <div className="lead-edit-field">
            <label>Department</label>
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>
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

        <div className="lead-edit-field">
          <label>Notes</label>
          <textarea
            value={form.notes}
            placeholder="Preferences, how they like to be reached..."
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
                Only people who can view and edit contacts are listed.
              </p>
            </>
          ) : (
            <>
              <div className="lead-edit-locked">
                <span>{ownerName ?? "Unassigned"}</span>
                <IconLock />
              </div>
              <p className="lead-edit-help">Only Management can reassign contacts.</p>
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
