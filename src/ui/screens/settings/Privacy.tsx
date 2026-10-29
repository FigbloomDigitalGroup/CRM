"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ROLES } from "../../../../prisma/seedData";
import { Banner, Button, Checkbox, ConfirmDialog, Dialog, Input, Select, Textarea } from "../..";
import { newIdempotencyKey } from "../../data/client";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, useReport, useWhen } from "./kit";

interface Retention {
  key: string;
  label: string;
  description: string;
  unit: string;
  value: number | null;
  default: number | null;
  min: number;
  max: number;
  isDefault: boolean;
}
interface Overview {
  exportRights: { allowedRoleKeys: string[]; approvalThreshold: number; approvalExpiryHours: number; thresholdRange: { min: number; max: number }; expiryRange: { min: number; max: number } };
  retention: Retention[];
  legalHold: { active: boolean; reason: string | null; since: string | null };
  requests: { open: number; overdue: number; dueDays: number };
  pendingExportApprovals: number;
}
interface Dsr {
  id: string;
  kind: "ACCESS" | "RECTIFICATION" | "ERASURE" | string;
  status: string;
  subject: { contactId: string | null; label: string };
  dueOn: string;
  overdue: boolean;
  daysLeft: number | null;
  hasExport: boolean;
  confirmations: { first: unknown; second: unknown };
}

const KIND: Record<string, string> = { ACCESS: "Access", RECTIFICATION: "Correction", ERASURE: "Deletion" };
const STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: "Open", tone: "warn" },
  IN_PROGRESS: { label: "In progress", tone: "warn" },
  AWAITING_SECOND_CONFIRMATION: { label: "Needs a second confirmation", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "ok" },
  REJECTED: { label: "Declined", tone: "" },
};
const ACTIVE = ["OPEN", "IN_PROGRESS", "AWAITING_SECOND_CONFIRMATION"];

/**
 * Data and privacy (S9, FIG-1111): who may export, how long data is kept, the legal hold, and customers' requests under the Kenya Data Protection Act, each
 * with its response deadline. Policy changes are audited by the API; every export is written to the audit log with who, when and how many rows. Bank, card and
 * M-Pesa details are never stored in the CRM.
 */
export function DataPrivacy() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getPrivacyOverview", { params: { orgSlug } });
  const o = q.data as unknown as Overview | undefined;
  return (
    <Gate q={q} area="Data and privacy">
      {o ? (
        <>
          <Panel title="Data & privacy" description="Customer data is only visible to the roles that need it. These settings support Kenya Data Protection Act requests.">
            <div className="fb-set-note"><span>Every export is written to the audit log with who, when and how many rows. Bank, card and M-Pesa details are never stored in the CRM.</span></div>
            {o.pendingExportApprovals > 0 ? <Banner tone="warning">{o.pendingExportApprovals} {o.pendingExportApprovals === 1 ? "export is" : "exports are"} waiting for approval.</Banner> : null}
          </Panel>
          <ExportRights o={o} />
          <RetentionPanel o={o} />
          <LegalHold o={o} />
          <Requests />
        </>
      ) : null}
    </Gate>
  );
}

function ExportRights({ o }: { o: Overview }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const [roles, setRoles] = useState(o.exportRights.allowedRoleKeys);
  const [threshold, setThreshold] = useState(String(o.exportRights.approvalThreshold));
  const [expiry, setExpiry] = useState(String(o.exportRights.approvalExpiryHours));
  const save = useApiMutation("updateExportRights", {
    invalidate: [["getPrivacyOverview", { orgSlug }, null]],
    onSuccess: () => report.ok("Export rights saved."),
    onError: (e) => report.fail(e, "The export rights did not save"),
  });
  return (
    <Panel title="Who can export to CSV" description="Management can always export. A large export needs a second person to approve it.">
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="fb-label">Roles that may export</legend>
        <div className="fb-set-days" style={{ marginTop: 8 }}>
          {ROLES.filter((r) => r.key !== "CUSTOMER_SUPPORT").map((r) => (
            <Checkbox key={r.key} label={r.name} checked={roles.includes(r.key)} disabled={r.key === "MANAGEMENT"} onChange={(e) => setRoles(e.target.checked ? [...roles, r.key] : roles.filter((k) => k !== r.key))} />
          ))}
        </div>
      </fieldset>
      <div className="fb-set-cols" style={{ maxWidth: 520 }}>
        <Input label="Approval needed above (rows)" type="number" min={o.exportRights.thresholdRange.min} max={o.exportRights.thresholdRange.max} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <Input label="Approval lasts (hours)" type="number" min={o.exportRights.expiryRange.min} max={o.exportRights.expiryRange.max} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <div><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ params: { orgSlug }, body: { allowedRoleKeys: roles, approvalThreshold: Number(threshold), approvalExpiryHours: Number(expiry) } })}>Save export rights</Button></div>
    </Panel>
  );
}

function RetentionPanel({ o }: { o: Overview }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(o.retention.map((r) => [r.key, r.value === null ? "" : String(r.value)])));
  const save = useApiMutation("updateRetention", {
    invalidate: [["getPrivacyOverview", { orgSlug }, null]],
    onSuccess: () => report.ok("Retention saved."),
    onError: (e) => report.fail(e, "The retention settings did not save"),
  });
  const body = () => Object.fromEntries(o.retention.map((r) => [r.key, vals[r.key] === "" ? null : Number(vals[r.key])]));
  return (
    <Panel title="How long data is kept" description="Leave a period empty to keep that data until you decide otherwise. Audit history is never shortened below its legal minimum.">
      <div className="fb-set-cols">
        {o.retention.map((r) => (
          <div key={r.key}>
            <Input label={`${r.label} (${r.unit})`} type="number" min={r.min} max={r.max} value={vals[r.key]} placeholder={r.default === null ? "Kept" : String(r.default)} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} help={r.description} />
          </div>
        ))}
      </div>
      <div><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ params: { orgSlug }, body: body() })}>Save retention</Button></div>
    </Panel>
  );
}

function LegalHold({ o }: { o: Overview }) {
  const { orgSlug } = useMember();
  const when = useWhen();
  const report = useReport();
  const [reason, setReason] = useState(o.legalHold.reason ?? "");
  const set = useApiMutation("setLegalHold", {
    invalidate: [["getPrivacyOverview", { orgSlug }, null]],
    onSuccess: (_d) => report.ok(o.legalHold.active ? "Legal hold lifted." : "Legal hold placed. Nothing is deleted while it is on."),
    onError: (e) => report.fail(e, "The legal hold did not change"),
  });
  return (
    <Panel title="Legal hold" description="While a hold is on, retention clean-up and deletions pause for the whole organisation.">
      {o.legalHold.active ? <Banner tone="warning">On since {when(o.legalHold.since)}{o.legalHold.reason ? `: ${o.legalHold.reason}` : ""}.</Banner> : null}
      {!o.legalHold.active ? <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
      <div>
        <Button variant={o.legalHold.active ? "secondary" : "danger"} loading={set.isPending} disabledReason={o.legalHold.active || reason.trim() ? undefined : "Say why the hold is needed."} onClick={() => set.mutate({ params: { orgSlug }, body: { active: !o.legalHold.active, ...(o.legalHold.active ? {} : { reason: reason.trim() }) } })}>{o.legalHold.active ? "Lift the hold" : "Place a legal hold"}</Button>
      </div>
    </Panel>
  );
}

function Requests() {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const when = useWhen();
  const q = useApiQuery("listDataSubjectRequests", { params: { orgSlug }, query: { pageSize: "25" } });
  const items = asArray<Dsr>((q.data as unknown as { items?: unknown[] } | undefined)?.items);
  const [log, setLog] = useState(false);
  const [act, setAct] = useState<{ r: Dsr; kind: "reject" | "erase" | "fulfil" } | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["listDataSubjectRequests"] }), qc.invalidateQueries({ queryKey: ["getPrivacyOverview", { orgSlug }, null] })]);
  async function run(work: () => Promise<unknown>, done: string, what: string) {
    try {
      await work();
      report.ok(done);
    } catch (e) {
      report.fail(e, what);
    } finally {
      await refresh();
    }
  }
  return (
    <>
      <Panel flush title="Data requests from customers" description="Access, correction and deletion requests, with their response deadline." actions={<Button variant="primary" onClick={() => setLog(true)}>Log a request</Button>}>
        <Gate q={q} area="Data requests" lines={3}>
          {items.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">No requests logged.</span></div> : null}
          {items.map((r) => {
            const s = STATUS[r.status] ?? { label: r.status, tone: "" };
            const active = ACTIVE.includes(r.status);
            return (
              <div key={r.id} className="fb-set-row" style={{ fontSize: 13.5 }}>
                <div className="fb-set-row__main">
                  <div className="fb-set-row__name">{r.subject.label} · {KIND[r.kind] ?? r.kind}</div>
                  <div className="fb-set-row__meta">{active ? (r.overdue ? `Overdue: was due ${when(r.dueOn)}` : `Reply by ${when(r.dueOn)}${r.daysLeft !== null ? ` (${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"} left)` : ""}`) : `Due ${when(r.dueOn)}`}</div>
                </div>
                <span className={`fb-set-pill ${r.overdue ? "fb-set-pill--bad" : s.tone ? `fb-set-pill--${s.tone}` : ""}`}>{r.overdue ? "Overdue" : s.label}</span>
                {active && r.kind === "ACCESS" ? <Button size="sm" onClick={() => setAct({ r, kind: "fulfil" })}>Prepare the data</Button> : null}
                {active && r.kind === "ERASURE" ? <Button size="sm" onClick={() => setAct({ r, kind: "erase" })}>Confirm deletion</Button> : null}
                {r.hasExport ? <Button size="sm" onClick={async () => { try { const d = (await api.call("getAccessDownload", { params: { orgSlug, requestId: r.id } })) as unknown as { download?: { url: string } }; if (d.download?.url) window.open(d.download.url, "_blank", "noopener"); } catch (e) { report.fail(e, "The file could not be opened"); } }}>Download</Button> : null}
                {active ? <Button size="sm" variant="ghost" onClick={() => { setReason(""); setAct({ r, kind: "reject" }); }}>Decline</Button> : null}
              </div>
            );
          })}
        </Gate>
      </Panel>
      {log ? <LogRequest onClose={() => setLog(false)} onSaved={() => { setLog(false); void refresh(); }} /> : null}
      <ConfirmDialog open={act?.kind === "fulfil"} onClose={() => setAct(null)} title="Prepare this person’s data?" body="A file with everything held about them is made and kept for the download window. The preparation is recorded." confirmLabel="Prepare" onConfirm={async () => { const r = act!.r; setAct(null); await run(() => api.call("fulfilAccessRequest", { params: { orgSlug, requestId: r.id } }), "The data was prepared.", "The data was not prepared"); }} />
      <ConfirmDialog open={act?.kind === "erase"} onClose={() => setAct(null)} title="Confirm this deletion?" tone="danger" body="Deleting a person’s data needs two different people to confirm. Your confirmation is recorded; the deletion happens once a second person confirms. It cannot be undone." confirmLabel="Confirm deletion" onConfirm={async () => { const r = act!.r; setAct(null); await run(() => api.call("confirmErasure", { params: { orgSlug, requestId: r.id } }), "Your confirmation was recorded.", "The confirmation did not go through"); }} />
      {act?.kind === "reject" ? (
        <Dialog open onClose={() => setAct(null)} title="Decline this request" actions={<><Button onClick={() => setAct(null)}>Cancel</Button><Button variant="danger" disabledReason={reason.trim() ? undefined : "Say why it is declined; the reason is kept with the request."} onClick={() => { const r = act.r; setAct(null); void run(() => api.call("rejectDataSubjectRequest", { params: { orgSlug, requestId: r.id }, body: { reason: reason.trim() } }), "The request was declined.", "The request was not declined"); }}>Decline</Button></>}>
          <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Dialog>
      ) : null}
    </>
  );
}

function LogRequest({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const report = useReport();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const contacts = useApiQuery("getContacts", { params: { orgSlug }, query: { q: debounced || undefined, pageSize: "8", page: "1" } }, { enabled: debounced.length > 1 });
  const [contactId, setContactId] = useState("");
  const [kind, setKind] = useState("ACCESS");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const list = asArray<{ id: string; firstName: string; lastName: string; email: string }>(contacts.data?.items);
  async function save() {
    setBusy(true);
    try {
      await api.call("createDataSubjectRequest", { params: { orgSlug }, body: { kind: kind as "ACCESS", contactId, ...(notes.trim() ? { evidenceNotes: notes.trim() } : {}) }, idempotencyKey: newIdempotencyKey() });
      report.ok("Request logged. The response deadline is set.");
      onSaved();
    } catch (e) {
      report.fail(e, "The request was not logged");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Log a data request" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabledReason={contactId ? undefined : "Find and choose the person first."} onClick={() => void save()}>Log request</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Select label="What are they asking for?" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "ACCESS", label: "A copy of their data" }, { value: "RECTIFICATION", label: "A correction" }, { value: "ERASURE", label: "Deletion" }]} />
        <Input label="Find the person" value={search} onChange={(e) => { setSearch(e.target.value); setContactId(""); }} placeholder="Name or email" />
        {list.length > 0 && !contactId ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--border)", borderRadius: 10 }} aria-label="Matching people">
            {list.map((c) => <li key={c.id}><button type="button" className="fb-btn fb-btn--ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { setContactId(c.id); setSearch(`${c.firstName} ${c.lastName}`.trim()); }}>{c.firstName} {c.lastName} · {c.email}</button></li>)}
          </ul>
        ) : null}
        <Textarea label="Evidence notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} help="How the request arrived and how you checked who they are." />
      </div>
    </Dialog>
  );
}
