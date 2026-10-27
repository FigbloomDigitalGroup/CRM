"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { contactOf, ownerLabel, useDebounced, useFormatters, useReference, useRefreshLeads, type LeadDetail } from "./data";
import { TEMPERATURES, TEMPERATURE_LABEL, tempTone, type Temperature } from "./format";
import { Icon } from "./icons";
import { SideDrawer } from "./overlay";

interface Form {
  name: string;
  phone: string;
  sourceId: string;
  serviceId: string;
  temp: Temperature;
  ownerId: string;
  nextStr: string;
  notes: string;
}

/**
 * New lead / Edit lead (L1, L3): "Capture now, qualify later." Only the name is required. A possible duplicate is shown as a warning and never
 * stops the save. The owner can be chosen only by people who may reassign; everyone else's new lead is simply theirs.
 */
export function LeadDrawer({ leadId, onClose, onSaved }: { leadId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { orgSlug, membershipId, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const ref = useReference();
  const fmt = useFormatters();
  const refresh = useRefreshLeads();
  const editing = Boolean(leadId);
  const detailQ = useApiQuery("getLeadsByLeadId", { params: { orgSlug, leadId: leadId ?? "" } }, { enabled: editing });
  const detail = detailQ.data as LeadDetail | undefined;

  // A new lead starts with a follow-up tomorrow, so it never goes cold unnoticed (the design's default).
  const [f, setF] = useState<Form>(() => ({ name: "", phone: "", sourceId: "", serviceId: "", temp: "WARM", ownerId: membershipId, nextStr: editing ? "" : new Date(Date.now() + 864e5).toISOString().slice(0, 10), notes: "" }));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const canAssign = can("leads.assign");

  useEffect(() => {
    if (!detail || loadedFor === detail.id) return;
    const c = contactOf(detail);
    setF({
      name: detail.company?.name ?? [c?.firstName, c?.lastName].filter(Boolean).join(" "),
      phone: (c?.phone as string | null) ?? (detail.company?.phone as string | null) ?? "",
      sourceId: (detail.leadSourceId as string | null) ?? "",
      serviceId: (detail.serviceInterestId as string | null) ?? "",
      temp: (detail.temperature as Temperature) ?? "WARM",
      ownerId: detail.ownerMembershipId ?? "",
      nextStr: fmt.isoDate(detail.nextFollowUpAt as string | null),
      notes: (detail.notes as string | null) ?? "",
    });
    setLoadedFor(detail.id);
  }, [detail, loadedFor, fmt]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // Possible duplicate: an existing company with that name, and an open lead for it. A warning, never a block.
  const typed = useDebounced(f.name.trim(), 350);
  const check = !editing && typed.length > 2;
  const companiesQ = useApiQuery("getCompanies", { params: { orgSlug }, query: { q: typed, pageSize: "5" } }, { enabled: check });
  const leadsQ = useApiQuery("listLeads", { params: { orgSlug }, query: { q: typed, pageSize: 3 } }, { enabled: check && can("leads.view.all") || (check && can("leads.view.own")) });
  const companies = (check ? ((companiesQ.data?.items ?? []) as { id: string; name: string; ownerMembershipId?: string | null }[]) : []);
  const exact = companies.find((c) => c.name.trim().toLowerCase() === f.name.trim().toLowerCase());
  const near = exact ?? companies[0];
  const openLead = check ? leadsQ.data?.items.find((l) => !l.archived && !l.convertedAt) : undefined;
  const dup = near || openLead
    ? near
      ? `${near.name} already exists as a company (owner ${ref.memberName(near.ownerMembershipId) ?? "unassigned"})${openLead ? " and has an open lead." : "."}`
      : `${openLead!.company?.name ?? "This"} is already an open lead.`
    : null;
  const dupHref = near ? `/o/${orgSlug}/companies/${near.id}` : openLead ? `/o/${orgSlug}/leads/${openLead.id}` : null;

  async function save() {
    const name = f.name.trim();
    if (!name) {
      setErrors({ name: "Enter a company or person." });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const newStatus = ref.statusByKey("NEW") ?? ref.statuses[0];
      if (editing && leadId) {
        await api.call("patchLeadsByLeadId", {
          params: { orgSlug, leadId },
          body: {
            leadSourceId: f.sourceId || null,
            serviceInterestId: f.serviceId || null,
            temperature: f.temp,
            nextFollowUpAt: f.nextStr ? new Date(`${f.nextStr}T10:00:00`).toISOString() : null,
            notes: f.notes.trim() || null,
          },
        });
        if (canAssign && f.ownerId && f.ownerId !== detail?.ownerMembershipId) {
          await api.call("postLeadsByLeadIdAssign", { params: { orgSlug, leadId }, body: { ownerMembershipId: f.ownerId }, idempotencyKey: newIdempotencyKey() });
        }
        toast.show({ message: "Lead saved" });
        await refresh();
        onSaved?.(leadId);
        return;
      }
      if (!newStatus) throw new Error("The lead statuses have not loaded.");
      let companyId = exact?.id;
      if (!companyId) {
        if (!can("companies.create")) {
          setErrors({ name: "That company is not in the system yet, and your role cannot add companies. Pick an existing one." });
          setBusy(false);
          return;
        }
        const company = await api.call("postCompanies", { params: { orgSlug }, body: { name, ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) }, idempotencyKey: newIdempotencyKey() });
        companyId = company.company.id;
      }
      const created = await api.call("createLead", {
        params: { orgSlug },
        idempotencyKey: newIdempotencyKey(),
        body: {
          leadStatusId: newStatus.id,
          companyId,
          ...(f.sourceId ? { leadSourceId: f.sourceId } : {}),
          ...(f.serviceId ? { serviceInterestId: f.serviceId } : {}),
          temperature: f.temp,
          ...(canAssign && f.ownerId && f.ownerId !== membershipId ? { ownerMembershipId: f.ownerId } : {}),
        },
      });
      const id = created.lead.id;
      if (f.nextStr || f.notes.trim()) {
        await api.call("patchLeadsByLeadId", {
          params: { orgSlug, leadId: id },
          body: { ...(f.nextStr ? { nextFollowUpAt: new Date(`${f.nextStr}T10:00:00`).toISOString() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) },
        });
      }
      toast.show({ message: `${name} added as a lead` });
      await refresh();
      onSaved?.(id);
    } catch (err) {
      const d = describeError(err);
      const map: Record<string, string> = {};
      for (const fe of d.fieldErrors) map[fe.path] = fe.message;
      setErrors(map);
      setFormError(d.body);
    } finally {
      setBusy(false);
    }
  }

  const ownerLocked = !canAssign;
  return (
    <SideDrawer
      title={editing ? "Edit lead" : "New lead"}
      subtitle="Capture now, qualify later."
      onClose={onClose}
      label={editing ? "Edit lead" : "New lead"}
      footer={
        <>
          <button type="button" className="fb-ld-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={!f.name.trim() || busy || (editing && !detail)} onClick={save}>
            <Icon name="plus" size={16} stroke={2.2} />
            {editing ? "Save changes" : "Create lead"}
          </button>
        </>
      }
    >
      <label className="fb-ld-field">
        <span>
          Company or person <span className="fb-ld-req" aria-hidden="true">*</span>
        </span>
        <input
          className="fb-ld-input"
          data-autofocus
          value={f.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Sarova Hotels or Amara Osei"
          required
          aria-required="true"
          aria-invalid={errors.name ? true : undefined}
          disabled={editing}
          list={editing ? undefined : "fb-ld-company-suggestions"}
          autoComplete="off"
        />
        {!editing ? (
          <datalist id="fb-ld-company-suggestions">
            {companies.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        ) : (
          <span className="fb-ld-help">
            <Icon name="lock" size={12} />
            Rename the company on its own page.
          </span>
        )}
        {errors.name ? <span className="fb-ld-error" role="alert">{errors.name}</span> : null}
      </label>
      {dup ? (
        <div role="status" className="fb-ld-dup">
          <Icon name="alert" size={17} />
          <div>
            <strong>Possible duplicate.</strong> {dup} You can still save this lead.
            {dupHref ? (
              <div>
                <Link href={dupHref}>Open existing record</Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="fb-ld-twocol">
        <label className="fb-ld-field">
          <span>Phone</span>
          <input className="fb-ld-input" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+254 7…" disabled={editing} inputMode="tel" />
        </label>
        <label className="fb-ld-field">
          <span>Source</span>
          <select className="fb-ld-select" value={f.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
            <option value="">Not known</option>
            {ref.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="fb-ld-field">
        <span>Service interest</span>
        <select className="fb-ld-select" value={f.serviceId} onChange={(e) => set("serviceId", e.target.value)}>
          <option value="">Not decided yet</option>
          {ref.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="fb-ld-field">
        <span id="fb-ld-temp-label" className="fb-ld-label">
          Temperature
        </span>
        <div className="fb-ld-temps fb-ld-temps--lg" role="group" aria-labelledby="fb-ld-temp-label">
          {TEMPERATURES.map((t) => {
            const on = f.temp === t;
            const [bg, fg] = tempTone(t);
            return (
              <button key={t} type="button" aria-pressed={on} onClick={() => set("temp", t)} style={on ? { background: bg, color: fg, borderColor: fg } : undefined}>
                {TEMPERATURE_LABEL[t]}
              </button>
            );
          })}
        </div>
      </div>
      <label className="fb-ld-field">
        <span>Owner</span>
        <select className="fb-ld-select" value={f.ownerId} onChange={(e) => set("ownerId", e.target.value)} disabled={ownerLocked}>
          {!ref.owners.some((o) => o.membershipId === f.ownerId) && f.ownerId ? <option value={f.ownerId}>{ref.memberName(f.ownerId) ?? "You"}</option> : null}
          {!f.ownerId ? <option value="">Unassigned</option> : null}
          {ref.owners.map((o) => (
            <option key={o.membershipId} value={o.membershipId}>
              {ownerLabel(o, membershipId)}
            </option>
          ))}
        </select>
        {ownerLocked ? (
          <span className="fb-ld-help">
            <Icon name="lock" size={12} />
            Leads you create are yours. Management can reassign them.
          </span>
        ) : null}
      </label>
      <label className="fb-ld-field">
        <span>Next follow-up</span>
        <input className="fb-ld-input" type="date" value={f.nextStr} onChange={(e) => set("nextStr", e.target.value)} />
      </label>
      <label className="fb-ld-field">
        <span>Notes</span>
        <textarea className="fb-ld-textarea" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What do they need?" />
      </label>
      <p className="fb-ld-footnote">Only the name is required. Qualification details can be added on the lead once you know more.</p>
      {formError ? (
        <div role="alert" className="fb-ld-error">
          {formError}
        </div>
      ) : null}
    </SideDrawer>
  );
}
