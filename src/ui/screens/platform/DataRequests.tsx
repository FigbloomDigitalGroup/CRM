"use client";

import { Clock, Download, File, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { DemoNotice } from "@/ui/demo/DemoBadge";
import type { RequestStatus } from "./demo/data";
import { dateShort, PageHead, StatusPill } from "./kit";
import { canApprove, hasTwoApprovals, needsTwoAdmins, retentionDaysLeft, stepLocked } from "./logic";
import { usePlatform } from "./store";

const STATUSES: RequestStatus[] = ["Received", "In review", "Approved", "Completed", "Rejected"];

/**
 * PL6 Data requests and offboarding: a list and the workflow for the chosen request. Deleting data needs two different platform admins; the step
 * that deletes stays locked until then, and the same admin cannot approve twice (the rule is `canApprove` in logic.ts, and the real API enforces it too).
 */
export function DataRequests() {
  const { state, now, dispatch, toast } = usePlatform();
  const params = useSearchParams();
  const [picked, setPicked] = useState<string | null>(params?.get("id") ?? null);
  const r = state.requests.find((x) => x.id === picked) ?? state.requests[0];
  const orgName = (id: string) => state.orgs.find((o) => o.id === id)?.name ?? "—";
  const adminName = (id: string) => state.admins.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <PageHead title="Data requests" release="V1.1" sub="Tenant offboarding, data-subject deletion and export requests (FIG-444). Deletion needs a second platform admin." />
      <DemoNotice what="Data requests" />
      <div className="fb-pl-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
        <section className="fb-pl-card fb-pl-card--flush" aria-label="Requests">
          {state.requests.map((x) => {
            const over = x.due < now && !["Completed", "Rejected"].includes(x.status);
            return (
              <button key={x.id} type="button" className="fb-pl-req" aria-pressed={x.id === r?.id} onClick={() => setPicked(x.id)}>
                <div className="fb-pl-req-top">
                  <strong style={{ fontSize: 14 }}>{x.type}</strong>
                  <StatusPill status={x.status} />
                </div>
                <div className="fb-pl-muted2 fb-pl-small" style={{ marginTop: 3 }}>{orgName(x.org)} · {x.subject}</div>
                <div className="fb-pl-small" style={{ marginTop: 4, fontWeight: 600, color: over ? "var(--pl-red)" : "var(--pl-text-3)" }}>
                  {over ? `Overdue · was due ${dateShort(x.due)}` : `Due ${dateShort(x.due)}`}
                </div>
              </button>
            );
          })}
          {!state.requests.length ? <div className="fb-pl-muted2" style={{ padding: 30, textAlign: "center" }}>Nothing waiting.</div> : null}
        </section>

        {r ? (
          <section className="fb-pl-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }} aria-label="Request detail">
            <div>
              <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 10.5 }}>{orgName(r.org).toUpperCase()} · RECEIVED {dateShort(r.received).toUpperCase()}</div>
              <h2 style={{ marginTop: 4, fontSize: 20 }}>{r.type} · {r.subject}</h2>
              <div className="fb-pl-muted2" style={{ fontSize: 13.5, marginTop: 4 }}>Requested by {r.requester} · due {dateShort(r.due)}</div>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="fb-pl-label">Status</span>
              <select className="fb-pl-select" style={{ width: "auto", height: 36 }} value={r.status} onChange={(e) => dispatch({ type: "request-status", id: r.id, status: e.target.value as RequestStatus })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <div className="fb-pl-steps-box">
              {r.steps.map(([label, done], i) => {
                const locked = stepLocked(r, label, done);
                return (
                  <label key={label} className="fb-pl-steplabel" data-done={done}>
                    <input type="checkbox" checked={done} disabled={locked} onChange={() => dispatch({ type: "request-step", id: r.id, index: i })} />
                    <span className="fb-pl-grow">{label}</span>
                    {locked ? <span className="fb-pl-small" style={{ color: "var(--pl-orange-text)", fontWeight: 600 }}>Needs second admin</span> : null}
                  </label>
                );
              })}
            </div>
            {needsTwoAdmins(r) ? <TwoPerson requestId={r.id} /> : null}
            {r.kind === "offboard" && r.status !== "Completed" ? (
              <div className="fb-pl-twoperson" style={{ background: "var(--pl-surface-2)" }}>
                <Clock size={16} aria-hidden="true" />
                Retention: data is kept for <strong>{retentionDaysLeft(r, now)} days</strong> more before deletion can run.
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="fb-pl-btn" style={{ height: 38 }} onClick={() => { dispatch({ type: "audit", action: "Export downloaded", org: orgName(r.org), target: r.subject }); toast("Download started. The link expires in 7 days."); }}>
                <Download size={15} aria-hidden="true" />
                Download export (expires 7 days)
              </button>
              {r.status === "Completed" ? (
                <button type="button" className="fb-pl-btn" style={{ height: 38 }} onClick={() => toast("Completion certificate downloaded (PDF)")}>
                  <File size={15} aria-hidden="true" />
                  Completion certificate
                </button>
              ) : null}
            </div>
            <label className="fb-pl-field">
              <span className="fb-pl-label">Evidence notes</span>
              <textarea className="fb-pl-textarea" rows={2} value={r.notes} onChange={(e) => dispatch({ type: "request-notes", id: r.id, notes: e.target.value })} />
            </label>
            <span className="fb-pl-sr">Approved by {r.approvals.map(adminName).join(", ") || "nobody yet"}</span>
          </section>
        ) : null}
      </div>
    </>
  );
}

function TwoPerson({ requestId }: { requestId: string }) {
  const { state, dispatch } = usePlatform();
  const r = state.requests.find((x) => x.id === requestId)!;
  const two = hasTwoApprovals(r);
  const can = canApprove(r, state.me);
  const name = (id: string) => state.admins.find((a) => a.id === id)?.name ?? id;
  // The demo has one sign-in, so it offers the next admin who has not approved yet.
  const other = state.admins.find((a) => a.id !== state.me && !r.approvals.includes(a.id));
  const text = two
    ? `Approved by ${r.approvals.map(name).join(" and ")}. Deletion can run.`
    : r.approvals.length
      ? `Approved by ${name(r.approvals[0]!)}. Waiting for a second, different admin.`
      : "Needs two different platform admins to approve.";
  return (
    <div className="fb-pl-twoperson" style={{ background: two ? "var(--pl-primary-soft)" : "var(--pl-orange-soft)", color: two ? "var(--pl-primary-text)" : "var(--pl-orange-text)" }}>
      <Users size={16} aria-hidden="true" />
      <span style={{ flex: 1 }}>
        <strong>Two-person rule.</strong> {text}
      </span>
      {can.ok ? (
        <button type="button" className="fb-pl-btn fb-pl-btn--primary fb-pl-btn--sm" style={{ height: 34, padding: "0 14px" }} onClick={() => dispatch({ type: "request-approve", id: r.id })}>
          Approve as second admin
        </button>
      ) : null}
      {!two && !can.ok && other ? (
        <button type="button" className="fb-pl-pending-demo" style={{ marginTop: 0 }} onClick={() => dispatch({ type: "request-approve", id: r.id, as: other.id })}>
          Demo: approve as {other.name}
        </button>
      ) : null}
    </div>
  );
}
