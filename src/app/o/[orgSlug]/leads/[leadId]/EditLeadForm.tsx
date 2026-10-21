"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../../_shared/Combobox";
import { IconLock } from "../../_shared/icons";

interface Option {
  id: string;
  name: string;
}

interface StatusOption extends Option {
  key: string;
}

export interface Owner {
  membershipId: string;
  userName: string;
  roleName: string;
}

export interface LeadFields {
  id: string;
  leadStatusId: string;
  leadSourceId: string | null;
  temperature: "HOT" | "WARM" | "COLD";
  notes: string | null;
  nextFollowUpAt: string;
  lostReasonId: string | null;
  ownerMembershipId: string | null;
  converted: boolean;
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * One edit form for both the list's drawer and the detail page. What it
 * offers follows the role: everyone who can edit a lead gets status,
 * temperature, source, follow-up and notes; the Owner field is a real
 * picker only for people holding `leads.assign` (Management) and a locked,
 * read-only line for everyone else. The server enforces the same rules.
 */
export function EditLeadForm({
  orgSlug,
  lead,
  leadStatuses,
  leadSources,
  lostReasons,
  owners,
  ownerName,
  canAssign,
  onCancel,
  onSaved,
  extraFooter,
}: {
  orgSlug: string;
  lead: LeadFields;
  leadStatuses: StatusOption[];
  leadSources: Option[];
  lostReasons: Option[];
  /** People this lead may be handed to. Empty unless `canAssign`. */
  owners: Owner[];
  ownerName: string | null;
  canAssign: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
  extraFooter?: React.ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    leadStatusId: lead.leadStatusId,
    leadSourceId: lead.leadSourceId ?? "",
    temperature: lead.temperature,
    notes: lead.notes ?? "",
    nextFollowUpAt: lead.nextFollowUpAt,
    lostReasonId: lead.lostReasonId ?? "",
    ownerMembershipId: lead.ownerMembershipId ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentStatus = leadStatuses.find((s) => s.id === form.leadStatusId);
  const isLost = currentStatus?.key === "LOST";

  // "Converted" is reached by converting the lead, never by picking it, so it
  // only appears as the (locked) current value of a lead that already is.
  const statusOptions: ComboOption[] = leadStatuses
    .filter((s) => s.key !== "CONVERTED" || s.id === lead.leadStatusId)
    .map((s) => ({ value: s.id, label: s.name }));
  const sourceOptions: ComboOption[] = [
    { value: "", label: "(unknown)" },
    ...leadSources.map((s) => ({ value: s.id, label: s.name })),
  ];
  const lostReasonOptions: ComboOption[] = [
    { value: "", label: "Choose a reason" },
    ...lostReasons.map((r) => ({ value: r.id, label: r.name })),
  ];
  const ownerOptions: ComboOption[] = owners.map((m) => ({
    value: m.membershipId,
    label: m.userName,
    sublabel: m.roleName,
    avatarLabel: initialsFor(m.userName),
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLost && !form.lostReasonId && !lead.converted) {
      setError("Choose a lost reason to mark this lead as Lost.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadStatusId: form.leadStatusId,
          leadSourceId: form.leadSourceId || null,
          temperature: form.temperature,
          notes: form.notes || null,
          nextFollowUpAt: form.nextFollowUpAt
            ? new Date(form.nextFollowUpAt).toISOString()
            : null,
          ...(isLost ? { lostReasonId: form.lostReasonId || null } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update lead.");

      if (
        canAssign &&
        form.ownerMembershipId &&
        form.ownerMembershipId !== (lead.ownerMembershipId ?? "")
      ) {
        const assignRes = await fetch(
          `/api/orgs/${orgSlug}/leads/${lead.id}/assign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerMembershipId: form.ownerMembershipId }),
          },
        );
        const assignBody = await assignRes.json();
        if (!assignRes.ok) {
          throw new Error(
            assignBody.error ?? "Saved, but the owner could not be changed.",
          );
        }
      }

      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update lead.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="lead-edit-form" onSubmit={handleSubmit}>
      <div className="lead-edit-body">
        {lead.converted && (
          <p className="lead-edit-note">
            This lead has been converted to a deal. Its status is locked; you
            can still update the notes and follow-up.
          </p>
        )}
        <div className="lead-edit-field">
          <label>Status</label>
          {lead.converted ? (
            <div className="lead-edit-locked">
              <span>{currentStatus?.name ?? "Converted"}</span>
              <IconLock />
            </div>
          ) : (
            <Combobox
              value={form.leadStatusId}
              options={statusOptions}
              onChange={(v) => setForm({ ...form, leadStatusId: v })}
              ariaLabel="Status"
              width={280}
            />
          )}
        </div>

        {isLost && !lead.converted && (
          <div className="lead-edit-field">
            <label>Lost reason</label>
            <Combobox
              value={form.lostReasonId}
              options={lostReasonOptions}
              onChange={(v) => setForm({ ...form, lostReasonId: v })}
              ariaLabel="Lost reason"
              width={280}
            />
            <p className="lead-edit-help">Required when a lead is marked Lost.</p>
          </div>
        )}

        <div className="lead-edit-field">
          <label>Temperature</label>
          <div className="seg" role="radiogroup" aria-label="Temperature">
            {(["HOT", "WARM", "COLD"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.temperature === t}
                className={`seg-option seg-${t.toLowerCase()}${
                  form.temperature === t ? " is-on" : ""
                }`}
                onClick={() => setForm({ ...form, temperature: t })}
              >
                {t[0] + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="lead-edit-field">
          <label>Source</label>
          <Combobox
            value={form.leadSourceId}
            options={sourceOptions}
            onChange={(v) => setForm({ ...form, leadSourceId: v })}
            ariaLabel="Source"
            width={280}
          />
        </div>

        <div className="lead-edit-field">
          <label>Next follow-up</label>
          <input
            type="datetime-local"
            value={form.nextFollowUpAt}
            onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
          />
        </div>

        <div className="lead-edit-field">
          <label>Notes</label>
          <textarea
            value={form.notes}
            placeholder="Context, next steps..."
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="lead-edit-field">
          <label>Owner</label>
          {canAssign && !lead.converted ? (
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
                The new owner is notified. Only people who can work on leads are
                listed.
              </p>
            </>
          ) : (
            <>
              <div className="lead-edit-locked">
                <span>{ownerName ?? "Unassigned"}</span>
                <IconLock />
              </div>
              <p className="lead-edit-help">
                {lead.converted
                  ? "The deal now owns this work."
                  : "Only Management can reassign leads."}
              </p>
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
