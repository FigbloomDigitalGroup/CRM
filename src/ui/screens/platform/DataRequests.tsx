"use client";

import { Clock, File, RefreshCw, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { dateShort, PageHead, PlDialog, SliceGate, StatusPill } from "./kit";
import { awaitingApproval, canApprove, canRunDeletion, hasAllApprovals, retentionDaysLeft } from "./logic";
import type { PlatformRequest } from "./model";
import { usePlatform } from "./store";

type Dialog = { kind: "reject" | "cancel" | "delete"; request: PlatformRequest } | null;

/**
 * PL6 Data requests and offboarding: the requests organisations made (/api/platform/data-requests) and the workflow for the chosen one. Deleting data
 * needs two different platform admins and the API enforces it (`canApprove` in logic.ts mirrors the rule to explain it). The export is downloaded by
 * the organisation's own Management, not here.
 */
export function DataRequests() {
  const { state, now, slices, actions, call, toast, can } = usePlatform();
  const params = useSearchParams();
  const [picked, setPicked] = useState<string | null>(params?.get("id") ?? null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const r = state.requests.find((x) => x.id === picked) ?? state.requests[0];
  const manage = can("platform.data_requests.manage");

  async function certificate(id: string) {
    try {
      const c = await call<{ content: unknown; organizationSlug: string }>("GET", `/api/platform/data-requests/${encodeURIComponent(id)}/certificate`);
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `deletion-certificate-${c.organizationSlug}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast("Certificate downloaded.");
    } catch {
      toast("The certificate couldn’t be loaded.");
    }
  }
  async function go(fn: () => Promise<{ ok: boolean }>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  return (
    <>
      <PageHead title="Data requests" release="V1.1" sub="Export and deletion requests made by organisations (FIG-444). A deletion needs two different platform admins." />
      <SliceGate slice={slices.requests} area="Data requests">
        <div className="fb-pl-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          <section className="fb-pl-card fb-pl-card--flush" aria-label="Requests">
            {state.requests.map((x) => (
              <button key={x.id} type="button" className="fb-pl-req" aria-pressed={x.id === r?.id} onClick={() => setPicked(x.id)}>
                <div className="fb-pl-req-top">
                  <strong style={{ fontSize: 14 }}>{x.type}</strong>
                  <StatusPill status={x.status} />
                </div>
                <div className="fb-pl-muted2 fb-pl-small" style={{ marginTop: 3 }}>{x.orgName} · {x.subject}</div>
                <div className="fb-pl-small" style={{ marginTop: 4, fontWeight: 600, color: "var(--pl-text-3)" }}>
                  Received {dateShort(x.received)}{x.due ? ` · deletion after ${dateShort(x.due)}` : ""}
                </div>
              </button>
            ))}
            {!state.requests.length ? <div className="fb-pl-muted2" style={{ padding: 30, textAlign: "center" }}>Nothing waiting. Requests appear here when an organisation’s Management asks for an export or a deletion.</div> : null}
          </section>

          {r ? (
            <section className="fb-pl-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }} aria-label="Request detail">
              <div>
                <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 10.5 }}>{r.orgName.toUpperCase()} · RECEIVED {dateShort(r.received).toUpperCase()}</div>
                <h2 style={{ marginTop: 4, fontSize: 20 }}>{r.type} · {r.subject}</h2>
                <div className="fb-pl-muted2" style={{ fontSize: 13.5, marginTop: 4 }}>Requested by {r.requester}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="fb-pl-label">Status</span>
                <StatusPill status={r.status} />
              </div>
              <div className="fb-pl-steps-box">
                {r.steps.map(([label, done]) => (
                  <label key={label} className="fb-pl-steplabel" data-done={done}>
                    <input type="checkbox" checked={done} disabled readOnly />
                    <span className="fb-pl-grow">{label}</span>
                  </label>
                ))}
              </div>
              {awaitingApproval(r) || r.status === "In review" ? <ApprovalPanel request={r} onReject={() => setDialog({ kind: "reject", request: r })} /> : null}
              {r.kind === "offboard" && r.status === "Approved" ? (
                <div className="fb-pl-twoperson" style={{ background: "var(--pl-surface-2)" }}>
                  <Clock size={16} aria-hidden="true" />
                  Retention: data is kept for <strong>{retentionDaysLeft(r, now)} days</strong> more before deletion can run.
                </div>
              ) : null}
              <div className="fb-pl-small fb-pl-muted2">
                Export: {r.exportStatus === "NONE" ? "not started" : r.exportStatus === "PACKAGING" ? "being packaged" : r.exportStatus === "READY" ? `ready for the organisation${r.exportExpiresAt ? ` until ${dateShort(r.exportExpiresAt)}` : ""}` : r.exportStatus === "FAILED" ? "failed" : "expired"}. The organisation’s Management downloads it from their own settings.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {r.status === "Approved" && (r.exportStatus === "FAILED" || r.exportStatus === "EXPIRED") ? (
                  <button type="button" className="fb-pl-btn" style={{ height: 38 }} disabled={busy || !manage} onClick={() => void go(() => actions.retryExport(r.id))}>
                    <RefreshCw size={15} aria-hidden="true" />
                    Package the export again
                  </button>
                ) : null}
                {r.kind === "offboard" && r.status === "Approved" ? (
                  <button type="button" className="fb-pl-btn fb-pl-btn--danger" style={{ height: 38 }} disabled={!canRunDeletion(r, now).ok || !manage} title={canRunDeletion(r, now).ok ? undefined : (canRunDeletion(r, now) as { reason: string }).reason} onClick={() => setDialog({ kind: "delete", request: r })}>
                    Delete organisation data
                  </button>
                ) : null}
                {r.status === "Received" || r.status === "In review" || r.status === "Approved" ? (
                  <button type="button" className="fb-pl-btn" style={{ height: 38 }} disabled={!manage} onClick={() => setDialog({ kind: "cancel", request: r })}>Cancel request</button>
                ) : null}
                {r.status === "Completed" && r.kind === "offboard" ? (
                  <button type="button" className="fb-pl-btn" style={{ height: 38 }} onClick={() => void certificate(r.id)}>
                    <File size={15} aria-hidden="true" />
                    Completion certificate
                  </button>
                ) : null}
              </div>
              <label className="fb-pl-field">
                <span className="fb-pl-label">Note from the organisation</span>
                <textarea className="fb-pl-textarea" rows={2} value={r.notes} readOnly />
              </label>
              <span className="fb-pl-sr">Approved by {r.approvalLabels.join(", ") || "nobody yet"}</span>
            </section>
          ) : null}
        </div>
      </SliceGate>
      <RequestDialog key={dialog ? `${dialog.kind}-${dialog.request.id}` : "none"} dialog={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function ApprovalPanel({ request: r, onReject }: { request: PlatformRequest; onReject: () => void }) {
  const { state, actions, can } = usePlatform();
  const [busy, setBusy] = useState(false);
  const all = hasAllApprovals(r);
  const check = canApprove(r, state.me);
  const left = r.approvalsRequired - r.approvals.length;
  const text = all
    ? `Approved by ${r.approvalLabels.join(" and ")}.`
    : r.approvals.length
      ? `Approved by ${r.approvalLabels.join(", ")}. Waiting for ${left} more, from a different admin.`
      : r.approvalsRequired > 1
        ? `Needs ${r.approvalsRequired} different platform admins to approve.`
        : "Needs one platform admin to approve.";
  return (
    <div className="fb-pl-twoperson" style={{ background: all ? "var(--pl-primary-soft)" : "var(--pl-orange-soft)", color: all ? "var(--pl-primary-text)" : "var(--pl-orange-text)" }}>
      <Users size={16} aria-hidden="true" />
      <span style={{ flex: 1 }}>
        <strong>{r.approvalsRequired > 1 ? "Two-person rule." : "Approval."}</strong> {text}
        {!check.ok && !all ? <span style={{ display: "block", fontSize: 12.5 }}>{check.reason}</span> : null}
      </span>
      {check.ok && can("platform.data_requests.manage") ? (
        <>
          <button
            type="button"
            className="fb-pl-btn fb-pl-btn--primary fb-pl-btn--sm"
            style={{ height: 34, padding: "0 14px" }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await actions.decide(r.id, "APPROVE");
              setBusy(false);
            }}
          >
            {r.approvals.length ? "Approve as second admin" : "Approve"}
          </button>
          <button type="button" className="fb-pl-btn fb-pl-btn--sm" style={{ height: 34, padding: "0 14px" }} onClick={onReject}>Reject</button>
        </>
      ) : null}
    </div>
  );
}

function RequestDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const { actions } = usePlatform();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!dialog) return null;
  const { kind, request: r } = dialog;
  const del = kind === "delete";
  const valid = del ? text === r.orgSlug : text.trim().length >= 5;
  const title = kind === "reject" ? "Reject this request?" : kind === "cancel" ? "Cancel this request?" : `Delete ${r.orgName}’s data?`;
  const cta = kind === "reject" ? "Reject request" : kind === "cancel" ? "Cancel request" : "Delete data";
  return (
    <PlDialog open onClose={onClose} title={title} label={`PL6 ${cta}`}>
      {del ? (
        <>
          <ul className="fb-pl-effects">
            <li>The organisation’s stored files, records and accounts used only by it are removed. This can’t be undone.</li>
            <li>A completion certificate (counts only) is kept.</li>
          </ul>
          <label className="fb-pl-field">
            <span className="fb-pl-label">Type <code className="fb-pl-kbd">{r.orgSlug}</code> to confirm</span>
            <input className="fb-pl-input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          </label>
        </>
      ) : (
        <label className="fb-pl-field">
          <span className="fb-pl-label">Reason (at least 5 characters)</span>
          <textarea className="fb-pl-textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      <div className="fb-pl-dialog-actions">
        <button type="button" className="fb-pl-btn" onClick={onClose}>Back</button>
        <button
          type="button"
          className="fb-pl-btn fb-pl-btn--danger"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            const res = kind === "reject" ? await actions.decide(r.id, "REJECT", text.trim()) : kind === "cancel" ? await actions.cancelRequest(r.id, text.trim()) : await actions.runDeletion(r.id, text);
            setBusy(false);
            if (res.ok) onClose();
          }}
        >
          {cta}
        </button>
      </div>
    </PlDialog>
  );
}
