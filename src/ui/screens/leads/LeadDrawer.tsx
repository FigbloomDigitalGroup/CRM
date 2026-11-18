"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { Combobox } from "../../components/combobox";
import { DateTimeField } from "../../components/forms";
import { defaultFollowUp } from "../../components/dateTimeZone";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { contactOf, ownerLabel, useDebounced, useFormatters, useReference, useRefreshLeads, type LeadDetail } from "./data";
import { TEMPERATURES, TEMPERATURE_LABEL, tempTone, type Temperature } from "./format";
import { Icon } from "./icons";
import { SideDrawer } from "./overlay";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Offered even before the organisation has them; choosing one adds it to the service list. */
const EXTRA_SERVICES = ["School Management System"];
const ROLE_SUGGESTIONS = ["Owner", "Decision maker", "Influencer", "Procurement", "Finance", "Technical", "Other"];

interface Form {
  name: string;
  phone: string;
  email: string;
  company: string;
  role: string;
  sourceId: string;
  serviceId: string;
  /** What is typed in the service field; null while untouched (then the lead's current service shows). */
  serviceText: string | null;
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
  const { orgSlug, membershipId, timeZone, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const ref = useReference();
  const fmt = useFormatters();
  const refresh = useRefreshLeads();
  const editing = Boolean(leadId);
  const detailQ = useApiQuery("getLeadsByLeadId", { params: { orgSlug, leadId: leadId ?? "" } }, { enabled: editing });
  const detail = detailQ.data as LeadDetail | undefined;

  // A new lead starts with a follow-up tomorrow, so it never goes cold unnoticed (the design's default).
  const [f, setF] = useState<Form>(() => ({ name: "", phone: "", email: "", company: "", role: "", sourceId: "", serviceId: "", serviceText: null, temp: "WARM", ownerId: membershipId, nextStr: editing ? "" : defaultFollowUp(new Date(), timeZone).toISOString(), notes: "" }));
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
      email: "",
      company: "",
      role: "",
      sourceId: (detail.leadSourceId as string | null) ?? "",
      serviceId: (detail.serviceInterestId as string | null) ?? "",
      serviceText: null,
      temp: (detail.temperature as Temperature) ?? "WARM",
      ownerId: detail.ownerMembershipId ?? "",
      nextStr: detail.nextFollowUpAt ? new Date(detail.nextFollowUpAt as string).toISOString() : "",
      notes: (detail.notes as string | null) ?? "",
    });
    setLoadedFor(detail.id);
  }, [detail, loadedFor, fmt]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // Possible duplicate: an existing company with that name, and an open lead for it. A warning, never a block.
  const typed = useDebounced(f.company.trim() || f.name.trim(), 350);
  const check = !editing && typed.length > 2;
  const companiesQ = useApiQuery("getCompanies", { params: { orgSlug }, query: { q: typed, pageSize: "5" } }, { enabled: check });
  const leadsQ = useApiQuery("listLeads", { params: { orgSlug }, query: { q: typed, pageSize: 3 } }, { enabled: check && can("leads.view.all") || (check && can("leads.view.own")) });
  const companies = (check ? ((companiesQ.data?.items ?? []) as { id: string; name: string; ownerMembershipId?: string | null }[]) : []);
  const exact = companies.find((c) => c.name.trim().toLowerCase() === (f.company.trim() || f.name.trim()).toLowerCase());
  const near = exact ?? companies[0];
  const openLead = check ? leadsQ.data?.items.find((l) => !l.archived && !l.convertedAt) : undefined;
  const dup = near || openLead
    ? near
      ? `${near.name} already exists as a company (owner ${ref.memberName(near.ownerMembershipId) ?? "unassigned"})${openLead ? " and has an open lead." : "."}`
      : `${openLead!.company?.name ?? "This"} is already an open lead.`
    : null;
  const dupHref = near ? `/o/${orgSlug}/companies/${near.id}` : openLead ? `/o/${orgSlug}/leads/${openLead.id}` : null;

  // A contact with this email is reused, not duplicated: say so before saving (FIG-1675).
  const emailTyped = useDebounced(f.email.trim().toLowerCase(), 350);
  const emailOk = EMAIL_RE.test(emailTyped);
  const contactsQ = useApiQuery("getContacts", { params: { orgSlug }, query: { q: emailTyped, pageSize: "5" } }, { enabled: !editing && emailOk && can("contacts.view") });
  const sameEmail = !editing && emailOk ? (((contactsQ.data?.items ?? []) as { id: string; email?: string | null; firstName?: string; lastName?: string | null }[]).find((c) => c.email?.toLowerCase() === emailTyped)) : undefined;
  const showRole = !editing && Boolean(f.company.trim() || f.email.trim());

  async function save() {
    const name = f.name.trim();
    if (!name) {
      setErrors({ name: "Enter a company or person." });
      return;
    }
    const email = f.email.trim().toLowerCase();
    if (!editing && email && !EMAIL_RE.test(email)) {
      setErrors({ email: "Enter a valid email address." });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      // Typed text: a service the organisation has is used; a new one is added by the server when the lead is saved.
      let serviceId = f.serviceId;
      let serviceName = "";
      if (f.serviceText !== null) {
        const typed = f.serviceText.trim().replace(/\s+/g, " ");
        const known = ref.services.find((s) => s.name.toLowerCase() === typed.toLowerCase());
        serviceId = known?.id ?? "";
        serviceName = known ? "" : typed;
      }
      const newStatus = ref.statusByKey("NEW") ?? ref.statuses[0];
      if (editing && leadId) {
        await api.call("patchLeadsByLeadId", {
          params: { orgSlug, leadId },
          body: {
            leadSourceId: f.sourceId || null,
            serviceInterestId: serviceName ? undefined : serviceId || null,
            ...(serviceName ? { serviceInterestName: serviceName } : {}),
            temperature: f.temp,
            nextFollowUpAt: f.nextStr || null,
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
      // A person or a company typed in the new fields: one request saves the lead, company and contact together (all or nothing).
      const withPerson = Boolean(f.company.trim() || email || f.role.trim());
      let companyId = withPerson ? undefined : exact?.id;
      let intake: Record<string, unknown> = {};
      if (withPerson) {
        const companyName = f.company.trim() || name;
        const picked = f.company.trim() ? undefined : exact;
        if (picked) companyId = picked.id;
        intake = {
          ...(companyId ? {} : { newCompanyName: companyName }),
          contact: { name, ...(email ? { email } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.role.trim() ? { role: f.role.trim() } : {}) },
        };
      } else if (!companyId) {
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
        body: ({
          leadStatusId: newStatus.id,
          ...(companyId ? { companyId } : {}),
          ...intake,
          ...(f.sourceId ? { leadSourceId: f.sourceId } : {}),
          ...(serviceId ? { serviceInterestId: serviceId } : {}),
          ...(serviceName ? { serviceInterestName: serviceName } : {}),
          temperature: f.temp,
          ...(canAssign && f.ownerId && f.ownerId !== membershipId ? { ownerMembershipId: f.ownerId } : {}),
        }) as never,
      });
      const id = created.lead.id;
      if (f.nextStr || f.notes.trim()) {
        await api.call("patchLeadsByLeadId", {
          params: { orgSlug, leadId: id },
          body: { ...(f.nextStr ? { nextFollowUpAt: f.nextStr } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) },
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
        <Combobox
          ariaLabel="Company or person"
          autoFocus
          value={f.name}
          onChange={(v) => set("name", v)}
          placeholder="e.g. Sarova Hotels or Amara Osei"
          required
          invalid={Boolean(errors.name)}
          disabled={editing}
          options={editing ? [] : companies.map((c) => c.name)}
        />
        {!editing ? null : (
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
      {!editing ? (
        <>
          <label className="fb-ld-field">
            <span>Email</span>
            <input className="fb-ld-input" type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" autoComplete="off" aria-invalid={errors.email || errors["contact.email"] ? true : undefined} />
            {errors.email || errors["contact.email"] ? <span className="fb-ld-error" role="alert">{errors.email ?? errors["contact.email"]}</span> : null}
            {sameEmail ? <span className="fb-ld-help" role="status">{[sameEmail.firstName, sameEmail.lastName].filter(Boolean).join(" ")} is already a contact with this email. They will be linked, not duplicated.</span> : null}
          </label>
          <label className="fb-ld-field">
            <span>Company</span>
            <Combobox ariaLabel="Company" value={f.company} onChange={(v) => set("company", v)} placeholder="Pick an existing company or type a new one" options={companies.map((c) => c.name)} />
            <span className="fb-ld-help">Leave empty if the name above is the company.</span>
          </label>
          {showRole ? (
            <label className="fb-ld-field">
              <span>Role in the company</span>
              <Combobox ariaLabel="Role in the company" value={f.role} onChange={(v) => set("role", v)} placeholder="e.g. Procurement manager" maxLength={80} options={ROLE_SUGGESTIONS} />
            </label>
          ) : null}
        </>
      ) : null}
      <label className="fb-ld-field">
        <span>Service interest</span>
        <Combobox
          ariaLabel="Service interest"
          value={f.serviceText ?? ref.service(f.serviceId)?.name ?? ""}
          onChange={(v) => set("serviceText", v)}
          placeholder="Not decided yet: pick one or type your own"
          maxLength={80}
          options={[...ref.services.map((s) => s.name), ...EXTRA_SERVICES.filter((n) => !ref.services.some((s) => s.name.toLowerCase() === n.toLowerCase()))]}
        />
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
      <DateTimeField label="Next follow-up" value={f.nextStr} onChange={(iso) => set("nextStr", iso)} warnPast={false} />
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
