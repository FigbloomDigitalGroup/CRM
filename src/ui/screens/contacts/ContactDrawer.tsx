"use client";

import { useEffect, useId, useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { ownerLabel, useDebounced, useReference } from "../leads/data";
import { Icon } from "../leads/icons";
import { SideDrawer } from "../leads/overlay";
import { useRefreshContacts, type ContactDetail } from "./data";

const NEW_COMPANY = "__new";

interface Form {
  first: string;
  last: string;
  /** A company id, "" for none, or NEW_COMPANY to create one when saving. */
  companyId: string;
  companyLabel: string;
  newCompany: string;
  title: string;
  department: string;
  phone: string;
  email: string;
  ownerId: string;
}

/** A company picked by typing: the server searches, so a large organisation is covered, not just the first page. */
function CompanyPicker({ value, label, onPick, canCreate }: { value: string; label: string; onPick: (id: string, label: string) => void; canCreate: boolean }) {
  const { orgSlug } = useMember();
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const q = useDebounced(text.trim(), 250);
  const resultsQ = useApiQuery("getCompanies", { params: { orgSlug }, query: { q: q || undefined, pageSize: "8" } as never }, { enabled: open });
  const items = ((resultsQ.data as { items?: { id: string; name: string }[] } | undefined)?.items ?? []).slice(0, 8);
  const chosen = value && value !== NEW_COMPANY ? label : "";
  return (
    <div className="fb-ct-combo">
      <input
        className="fb-ld-input"
        role="combobox"
        aria-label="Company"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={chosen || "No company (standalone contact)"}
        value={open ? text : chosen}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {value ? (
        <button type="button" className="fb-ct-combo__clear" aria-label="Clear company" onClick={() => onPick("", "")}>
          <Icon name="x" size={14} />
        </button>
      ) : null}
      {open ? (
        <ul id={listId} role="listbox" aria-label="Companies" className="fb-ct-combo__list">
          <li role="option" aria-selected={!value} onMouseDown={(e) => { e.preventDefault(); onPick("", ""); setOpen(false); }}>
            No company (standalone contact)
          </li>
          {items.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value} onMouseDown={(e) => { e.preventDefault(); onPick(c.id, c.name); setOpen(false); setText(""); }}>
              {c.name}
            </li>
          ))}
          {canCreate ? (
            <li role="option" aria-selected={value === NEW_COMPANY} onMouseDown={(e) => { e.preventDefault(); onPick(NEW_COMPANY, "New company…"); setOpen(false); setText(""); }}>
              + New company…
            </li>
          ) : null}
          {!resultsQ.isLoading && items.length === 0 ? (
            <li role="presentation" className="fb-ct-combo__none">
              No company matches.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * New contact / Edit contact (C3). "Phone or email is enough to start": only the first name is required. A contact may have no company (a
 * standalone contact). Owner can be changed only by people who may reassign (Management); everyone else's new contact is simply theirs.
 */
export function ContactDrawer({ contactId, companyId, onClose, onSaved }: { contactId?: string; companyId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { orgSlug, membershipId, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const ref = useReference();
  const refresh = useRefreshContacts();
  const editing = Boolean(contactId);
  const detailQ = useApiQuery("getContactsByContactId", { params: { orgSlug, contactId: contactId ?? "" } }, { enabled: editing });
  const detail = detailQ.data as ContactDetail | undefined;
  const canAssign = can("membership.manage") && can("contacts.edit");

  const [f, setF] = useState<Form>({ first: "", last: "", companyId: companyId ?? "", companyLabel: "", newCompany: "", title: "", department: "", phone: "", email: "", ownerId: membershipId });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // A new contact started from a company page shows that company's name once it is known.
  const startCompany = useApiQuery("getCompaniesByCompanyId", { params: { orgSlug, companyId: companyId ?? "" } }, { enabled: Boolean(companyId) && !editing });
  useEffect(() => {
    const name = (startCompany.data as { name?: string } | undefined)?.name;
    if (name && f.companyId === companyId && !f.companyLabel) setF((x) => ({ ...x, companyLabel: name }));
  }, [startCompany.data, companyId, f.companyId, f.companyLabel]);

  useEffect(() => {
    if (!detail || loadedFor === detail.id) return;
    setF({
      first: detail.firstName ?? "",
      last: (detail.lastName as string | null) ?? "",
      companyId: (detail.companyId as string | null) ?? "",
      companyLabel: detail.company?.name ?? "",
      newCompany: "",
      title: (detail.jobTitle as string | null) ?? "",
      department: (detail.department as string | null) ?? "",
      phone: (detail.phone as string | null) ?? "",
      email: (detail.email as string | null) ?? "",
      ownerId: detail.ownerMembershipId ?? membershipId,
    });
    setLoadedFor(detail.id);
  }, [detail, loadedFor, membershipId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!f.first.trim()) {
      setErrors({ first: "Enter a first name." });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      let company = f.companyId;
      if (company === NEW_COMPANY) {
        const name = f.newCompany.trim();
        if (!name) {
          setErrors({ newCompany: "Enter the new company's name, or choose no company." });
          setBusy(false);
          return;
        }
        const made = await api.call("postCompanies", { params: { orgSlug }, body: { name }, idempotencyKey: newIdempotencyKey() });
        company = made.company.id;
      }
      const fields = {
        firstName: f.first.trim(),
        lastName: f.last.trim(),
        phone: f.phone.trim(),
        email: f.email.trim(),
        jobTitle: f.title.trim(),
        department: f.department.trim(),
      };
      if (editing && contactId) {
        await api.call("patchContactsByContactId", {
          params: { orgSlug, contactId },
          body: { ...fields, companyId: company || null, ...(canAssign && f.ownerId && f.ownerId !== detail?.ownerMembershipId ? { ownerMembershipId: f.ownerId } : {}) },
        });
        toast.show({ message: "Contact saved" });
        await refresh();
        onSaved?.(contactId);
        return;
      }
      const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
      const created = await api.call("postContacts", {
        params: { orgSlug },
        idempotencyKey: newIdempotencyKey(),
        body: { ...(clean as { firstName: string }), firstName: fields.firstName, ...(company ? { companyId: company } : {}), ...(canAssign && f.ownerId && f.ownerId !== membershipId ? { ownerMembershipId: f.ownerId } : {}) },
      });
      const dupes = created.possibleDuplicates?.length ?? 0;
      toast.show({ message: dupes ? `Contact created. ${dupes} possible duplicate${dupes === 1 ? "" : "s"} found: check Contacts to merge.` : "Contact created" });
      await refresh();
      onSaved?.(created.contact.id);
    } catch (err) {
      const d = describeError(err);
      if (d.fieldErrors.length) {
        const next: Record<string, string> = {};
        for (const fe of d.fieldErrors) {
          const key = fe.path === "firstName" ? "first" : fe.path;
          next[key] = fe.message;
        }
        setErrors(next);
      }
      setFormError(d.body);
    } finally {
      setBusy(false);
    }
  }

  const ownerLocked = !canAssign;
  return (
    <SideDrawer
      title={editing ? "Edit contact" : "New contact"}
      subtitle="Phone or email is enough to start."
      onClose={onClose}
      label={editing ? "Edit contact" : "New contact"}
      footer={
        <>
          <button type="button" className="fb-ld-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={!f.first.trim() || busy || (editing && !detail)} onClick={save}>
            <Icon name="plus" size={16} stroke={2.2} />
            {editing ? "Save changes" : "Create contact"}
          </button>
        </>
      }
    >
      <div className="fb-ld-twocol">
        <label className="fb-ld-field">
          <span>
            First name <span className="fb-ld-req" aria-hidden="true">*</span>
          </span>
          <input className="fb-ld-input" data-autofocus value={f.first} onChange={(e) => set("first", e.target.value)} required aria-required="true" aria-invalid={errors.first ? true : undefined} />
          {errors.first ? <span className="fb-ld-error" role="alert">{errors.first}</span> : null}
        </label>
        <label className="fb-ld-field">
          <span>Last name</span>
          <input className="fb-ld-input" value={f.last} onChange={(e) => set("last", e.target.value)} />
        </label>
      </div>
      <div className="fb-ld-field">
        <span className="fb-ld-label">Company</span>
        <CompanyPicker value={f.companyId} label={f.companyLabel} canCreate={can("companies.create")} onPick={(id, label) => setF((x) => ({ ...x, companyId: id, companyLabel: label }))} />
      </div>
      {f.companyId === NEW_COMPANY ? (
        <label className="fb-ld-field">
          <span>New company name</span>
          <input className="fb-ld-input" value={f.newCompany} onChange={(e) => set("newCompany", e.target.value)} placeholder="Created when you save" aria-invalid={errors.newCompany ? true : undefined} />
          {errors.newCompany ? <span className="fb-ld-error" role="alert">{errors.newCompany}</span> : null}
        </label>
      ) : null}
      <div className="fb-ld-twocol">
        <label className="fb-ld-field">
          <span>Job title</span>
          <input className="fb-ld-input" value={f.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="fb-ld-field">
          <span>Department</span>
          <input className="fb-ld-input" value={f.department} onChange={(e) => set("department", e.target.value)} placeholder="e.g. Finance" />
        </label>
      </div>
      <label className="fb-ld-field">
        <span>Phone</span>
        <input className="fb-ld-input" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+254 7…" inputMode="tel" aria-invalid={errors.phone ? true : undefined} />
        {errors.phone ? <span className="fb-ld-error" role="alert">{errors.phone}</span> : null}
      </label>
      <label className="fb-ld-field">
        <span>Email</span>
        <input className="fb-ld-input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} aria-invalid={errors.email ? true : undefined} />
        {errors.email ? <span className="fb-ld-error" role="alert">{errors.email}</span> : null}
      </label>
      <label className="fb-ld-field">
        <span>Owner</span>
        <select className="fb-ld-select" value={f.ownerId} onChange={(e) => set("ownerId", e.target.value)} disabled={ownerLocked}>
          {!ref.owners.some((o) => o.membershipId === f.ownerId) && f.ownerId ? <option value={f.ownerId}>{ref.memberName(f.ownerId) ?? "You"}</option> : null}
          {ref.owners.map((o) => (
            <option key={o.membershipId} value={o.membershipId}>
              {ownerLabel(o, membershipId)}
            </option>
          ))}
        </select>
        {ownerLocked ? (
          <span className="fb-ld-help">
            <Icon name="lock" size={12} />
            Contacts you create are yours. Management can reassign them.
          </span>
        ) : null}
      </label>
      {formError ? (
        <div role="alert" className="fb-ld-error">
          {formError}
        </div>
      ) : null}
    </SideDrawer>
  );
}
