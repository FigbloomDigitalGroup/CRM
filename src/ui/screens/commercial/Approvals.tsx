"use client";

import { Briefcase, Download, Percent, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, EmptyState, LoadingState, NoAccess, ReleaseTag, Tabs, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, useApprovals, useCancelApproval, useDecideApproval, whenLabel, type ApprovalItem, type ApprovalKind } from "./api";

/**
 * Approvals inbox (Q3, FIG-1169), on `GET /approvals` and `POST /approvals/{id}/decision` (docs/QUOTES_AND_APPROVALS.md). Requests that need a
 * Management decision, with the rule that raised each. Nothing is decided automatically (hard rule 9): a person approves or declines, and a decline
 * carries a reason the requester sees. Anyone who can raise a request sees their own as a read-only status view. The API sends no amounts.
 */

const ICON: Record<ApprovalKind, ReactNode> = {
  DISCOUNT: <Percent size={18} aria-hidden="true" />,
  EXPORT: <Download size={18} aria-hidden="true" />,
  DELETION: <Trash2 size={18} aria-hidden="true" />,
  LARGE_DEAL: <Briefcase size={18} aria-hidden="true" />,
};

const KIND_LABEL: Record<ApprovalKind, string> = { DISCOUNT: "Discount", EXPORT: "Export", DELETION: "Deletion", LARGE_DEAL: "Large deal" };

const STATUS_TEXT: Record<string, string> = { APPROVED: "Approved", REJECTED: "Declined", CANCELLED: "Withdrawn", EXPIRED: "Expired" };

export function Approvals() {
  const { orgSlug, can, roleName, membershipId } = useMember();
  const toast = useToast();
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allowed = can("quotes.approve") || can("quotes.create");
  const q = useApprovals(orgSlug);
  const decideM = useDecideApproval();
  const cancelM = useCancelApproval();

  if (!allowed) return <NoAccess area="Approvals" denial={{ yourRole: roleName, ownerRoles: ["Management"], whoToAsk: ["Management"] }} />;

  const approver = q.data?.canDecide ?? can("quotes.approve");
  const items = q.data?.items ?? [];
  const waiting = items.filter((a) => a.status === "PENDING");
  const decided = items.filter((a) => a.status !== "PENDING");
  const list = tab === "pending" ? waiting : decided;

  function decide(a: ApprovalItem, approve: boolean) {
    const reason = (notes[a.id] ?? "").trim();
    if (!approve && reason.length < 3) {
      setErrors((e) => ({ ...e, [a.id]: "Say why, so the requester knows what to change." }));
      return;
    }
    setErrors((e) => ({ ...e, [a.id]: "" }));
    decideM
      .mutateAsync({ params: { orgSlug, approvalId: a.id }, body: { approve, ...(reason ? { reason } : {}) } })
      .then(
        () => toast.show({ message: `${a.title} ${approve ? "approved" : "declined"}. ${a.requestedBy.name ?? "The requester"} is told.`, tone: approve ? "success" : "info" }),
        (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
      );
  }

  const link = (a: ApprovalItem) => (a.subject.dealId && a.kind === "DISCOUNT" ? `/o/${orgSlug}/quotes/${a.subject.dealId}` : null);

  const panel =
    list.length === 0 ? (
      <EmptyState title={tab === "pending" ? "Nothing waiting for you." : "No decisions yet."} body={approver ? "New requests appear here when a rule needs a decision." : "Your requests and their outcomes appear here."} />
    ) : (
      <ul className="fb-com-list">
        {list.map((a) => {
          const pending = a.status === "PENDING";
          const href = link(a);
          const mine = a.requestedBy.membershipId === membershipId;
          return (
            <li key={a.id} className="fb-com-card fb-com-approval">
              <span className={`fb-com-approval__icon${a.kind === "DELETION" ? " fb-com-approval__icon--danger" : ""}`}>{ICON[a.kind]}</span>
              <div className="fb-com-approval__main">
                <div className="fb-com-eyebrow">
                  {KIND_LABEL[a.kind] ?? a.kindLabel} · requested by {a.requestedBy.name ?? "a team member"} · {whenLabel(a.requestedAt)}
                </div>
                <h2 className="fb-com-approval__target">{a.title}</h2>
                <p className="fb-com-muted">{a.summary}</p>
                {a.requesterNote ? <p className="fb-com-muted">Note: {a.requesterNote}</p> : null}
                {a.resumeError ? <p className="fb-com-muted">Approved, but the action could not run by itself: {a.resumeError}</p> : null}
                {pending && approver && a.canDecide ? (
                  <label className="fb-com-reason">
                    <span className="fb-sr-only">Reason for {a.title}</span>
                    <input
                      className="fb-input"
                      placeholder="Reason (shown to the requester)"
                      value={notes[a.id] ?? ""}
                      aria-invalid={errors[a.id] ? true : undefined}
                      onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                    />
                    {errors[a.id] ? <span className="fb-error" role="alert">{errors[a.id]}</span> : null}
                  </label>
                ) : null}
              </div>
              <div className="fb-com-approval__actions">
                {pending && approver && a.canDecide ? (
                  <>
                    {href ? <Link className="fb-btn fb-btn--secondary" href={href}>Open</Link> : null}
                    <Button variant="danger" disabled={decideM.isPending} onClick={() => decide(a, false)}>Decline</Button>
                    <Button variant="primary" disabled={decideM.isPending} onClick={() => decide(a, true)}>Approve</Button>
                  </>
                ) : pending ? (
                  <>
                    <span className="fb-com-pill fb-com-pill--warn">Waiting for Management</span>
                    {mine && a.source === "REQUEST" ? (
                      <Button
                        disabled={cancelM.isPending}
                        onClick={() =>
                          cancelM.mutateAsync({ params: { orgSlug, approvalId: a.id } }).then(
                            () => toast.show({ message: "Request withdrawn", tone: "info" }),
                            (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
                          )
                        }
                      >
                        Withdraw
                      </Button>
                    ) : !a.canDecide && approver && mine ? <span className="fb-com-muted">Someone else has to decide your own request.</span> : null}
                  </>
                ) : (
                  <span className={`fb-com-pill fb-com-pill--${a.status === "APPROVED" ? "ok" : a.status === "REJECTED" ? "bad" : "warn"}`}>
                    {STATUS_TEXT[a.status] ?? a.status}
                    {a.decisionReason ? ` · ${a.decisionReason}` : ""}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="fb-com" data-screen-label="Approvals inbox">
      <header>
        <div className="fb-com-titlerow">
          <h1 className="fb-com__title">Approvals</h1>
          <ReleaseTag release="v1.1" />
        </div>
        <p className="fb-com__sub">
          {approver ? "Requests that need a Management decision. Rules live in Settings › Approval rules. Nothing is decided automatically." : "Your requests and what Management decided. A reason is shown when one is given."}
        </p>
      </header>
      {q.isLoading ? (
        <LoadingState label="Loading approvals" />
      ) : q.error ? (
        <QueryFailure error={q.error} area="Approvals" onRetry={() => void q.refetch()} />
      ) : (
        <Tabs
          label="Approval status"
          value={tab}
          onChange={(id) => setTab(id as "pending" | "done")}
          tabs={[
            { id: "pending", label: <>Waiting <span className="fb-com-count">{q.data?.pending ?? waiting.length}</span></>, panel },
            { id: "done", label: <>Decided <span className="fb-com-count">{decided.length}</span></>, panel },
          ]}
        />
      )}
      <p className="fb-sr-only" aria-live="polite">{list.length} requests shown</p>
    </div>
  );
}
