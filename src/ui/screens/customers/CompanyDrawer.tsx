"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { Icon } from "../leads/icons";
import { SideDrawer } from "../leads/overlay";
import { useCustomerReference, useDebounced } from "./data";

interface Form {
  name: string;
  industry: string;
  website: string;
  location: string;
  phone: string;
  email: string;
  notes: string;
  lifecycleStateId: string;
  ownerId: string;
}

/**
 * New company / Edit company (C1, C2): only the name is required. A company that looks like an existing one is shown as a warning with a link
 * to it, never as a block. The owner can be chosen only by people who may reassign; everyone else's new company is simply theirs.
 */
export function CompanyDrawer({ companyId, onClose, onSaved }: { companyId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { orgSlug, membershipId, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useCustomerReference();
  const editing = Boolean(companyId);
  const detailQ = useApiQuery("getCompaniesByCompanyId", { params: { orgSlug, companyId: companyId ?? "" } }, { enabled: editing });
  const canAssign = can("membership.manage") && can("companies.edit");

  const [f, setF] = useState<Form>({ name: "", industry: "", website: "", location: "", phone: "", email: "", notes: "", lifecycleStateId: "", ownerId: membershipId });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const d = detailQ.data as Record<string, unknown> | undefined;
    if (!d || loadedFor === d.id) return;
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setF({ name: s(d.name), industry: s(d.industry), website: s(d.website), location: s(d.location), phone: s(d.phone), email: s(d.email), notes: s(d.notes), lifecycleStateId: s(d.lifecycleStateId), ownerId: s(d.ownerMembershipId) });
    setLoadedFor(String(d.id));
  }, [detailQ.data, loadedFor]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // A possible duplicate: a company with that name (or email or phone). A warning, never a block.
  const typed = useDebounced(f.name.trim(), 350);
  const [dups, setDups] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (editing || typed.length < 3 || !can("companies.create")) return;
    let live = true;
    api
      .call("postCompaniesCheckDuplicates", { params: { orgSlug }, body: { name: typed, email: f.email.trim() || undefined, phone: f.phone.trim() || undefined }, idempotencyKey: newIdempotencyKey() } as never)
      .then((r) => live && setDups(((r as { possibleDuplicates?: { id: string; name: string }[] }).possibleDuplicates ?? []).slice(0, 3)))
      .catch(() => live && setDups([]));
    return () => {
      live = false;
    };
  }, [api, orgSlug, editing, typed, f.email, f.phone, can]);

  async function save() {
    const name = f.name.trim();
    if (!name) {
      setErrors({ name: "Enter the company name." });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body: Record<string, unknown> = { name, industry: f.industry.trim() || undefined, website: f.website.trim() || undefined, location: f.location.trim() || undefined, phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, notes: f.notes.trim() || undefined };
    try {
      if (editing) {
        await api.call("patchCompaniesByCompanyId", { params: { orgSlug, companyId: companyId! }, body: { ...body, industry: f.industry.trim(), website: f.website.trim(), location: f.location.trim(), phone: f.phone.trim(), notes: f.notes.trim(), ...(canAssign && f.ownerId ? { ownerMembershipId: f.ownerId } : {}) } } as never);
        toast.show({ tone: "success", message: "Company saved." });
        await qc.invalidateQueries();
        onSaved?.(companyId!);
      } else {
        const res = (await api.call("postCompanies", {
          params: { orgSlug },
          body: { ...body, ...(f.lifecycleStateId ? { lifecycleStateId: f.lifecycleStateId } : {}), ...(canAssign && f.ownerId ? { ownerMembershipId: f.ownerId } : {}) },
          idempotencyKey: newIdempotencyKey(),
        } as never)) as { company: { id: string } };
        toast.show({ tone: "success", message: `${name} added.` });
        await qc.invalidateQueries();
        onSaved?.(res.company.id);
      }
    } catch (err) {
      const d = describeError(err);
      const map: Record<string, string> = {};
      for (const e of d.fieldErrors) map[e.path] = e.message;
      setErrors(map);
      setFormError(d.fieldErrors.length ? null : d.body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideDrawer
      title={editing ? "Edit company" : "New company"}
      subtitle={editing ? "Change the details. Lifecycle changes are made on the company page." : "Only the name is required. Add the rest when you have it."}
      onClose={onClose}
      label={editing ? "Edit company" : "New company"}
      footer={
        <>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={busy || (editing && !detailQ.data)} onClick={save}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add company"}
          </button>
        </>
      }
    >
      <label className="fb-ld-field">
        <span>Company name *</span>
        <input className="fb-ld-input" value={f.name} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "co-name-err" : undefined} autoFocus />
        {errors.name ? (
          <span id="co-name-err" role="alert" className="fb-ld-error">
            {errors.name}
          </span>
        ) : null}
      </label>
      {dups.length ? (
        <div className="fb-ld-dup" role="status">
          <Icon name="alert" size={16} />
          <div>
            This looks like a company you already have:
            <ul>
              {dups.map((d) => (
                <li key={d.id}>
                  <Link href={`/o/${orgSlug}/companies/${d.id}`}>{d.name}</Link>
                </li>
              ))}
            </ul>
            You can still add it.
          </div>
        </div>
      ) : null}
      <div className="fb-ld-twocol">
        <label className="fb-ld-field">
          <span>Industry</span>
          <input className="fb-ld-input" value={f.industry} onChange={(e) => set("industry", e.target.value)} />
        </label>
        <label className="fb-ld-field">
          <span>Location</span>
          <input className="fb-ld-input" value={f.location} onChange={(e) => set("location", e.target.value)} />
        </label>
      </div>
      <div className="fb-ld-twocol">
        <label className="fb-ld-field">
          <span>Phone</span>
          <input className="fb-ld-input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="fb-ld-field">
          <span>Email</span>
          <input className="fb-ld-input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} aria-invalid={Boolean(errors.email)} />
          {errors.email ? (
            <span role="alert" className="fb-ld-error">
              {errors.email}
            </span>
          ) : null}
        </label>
      </div>
      <label className="fb-ld-field">
        <span>Website</span>
        <input className="fb-ld-input" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
        {errors.website ? (
          <span role="alert" className="fb-ld-error">
            {errors.website}
          </span>
        ) : null}
      </label>
      {!editing ? (
        <label className="fb-ld-field">
          <span>Lifecycle</span>
          <select className="fb-ld-select" value={f.lifecycleStateId} onChange={(e) => set("lifecycleStateId", e.target.value)}>
            <option value="">Prospect (default)</option>
            {ref.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {canAssign ? (
        <label className="fb-ld-field">
          <span>Owner</span>
          <select className="fb-ld-select" value={f.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
            {ref.members.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.userName} ({m.roleName})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="fb-ld-field">
        <span>Notes</span>
        <textarea className="fb-ld-textarea" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      {formError ? (
        <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
          <div>{formError}</div>
        </div>
      ) : null}
    </SideDrawer>
  );
}
