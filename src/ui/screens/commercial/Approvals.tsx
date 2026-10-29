"use client";

import { Briefcase, Download, Percent, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, EmptyState, NoAccess, ReleaseTag, Tabs, useMember, useToast } from "@/ui";
import type { ApprovalKind, DemoApproval } from "./demo/data";
import { decideApproval, useDemoStore } from "./demo/store";

/**
 * Approvals inbox (Q3, FIG-1169; design-spec/CrmGrowth.dc.html). Requests that need a Management decision, with the rule that raised each.
 * Nothing is decided automatically (hard rule 9): a person approves or declines, and a decline carries a reason the requester sees. Anyone who
 * can raise a request sees their own here as a read-only status view, with the reason once it is decided. Demo data until B6.13 is wired.
 */

const ICON: Record<ApprovalKind, ReactNode> = {
  Discount: <Percent size={18} aria-hidden="true" />,
  Export: <Download size={18} aria-hidden="true" />,
  Deletion: <Trash2 size={18} aria-hidden="true" />,
  "Large deal": <Briefcase size={18} aria-hidden="true" />,
};

const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Approvals() {
  const { orgSlug, can, userName, roleName } = useMember();
  const store = useDemoStore();
  const toast = useToast();
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const approver = can("quotes.approve");
  if (!approver && !can("quotes.create")) {
    return <NoAccess area="Approvals" denial={{ yourRole: roleName, ownerRoles: ["Management"], whoToAsk: ["Management"] }} />;
  }

  // An approver sees every request; a requester sees only their own, as a status view.
  const visible = store.approvals.filter((a) => approver || a.by === userName);
  const waiting = visible.filter((a) => a.status === "Pending");
  const decided = visible.filter((a) => a.status !== "Pending");
  const list = tab === "pending" ? waiting : decided;

  function decide(a: DemoApproval, status: "Approved" | "Declined") {
    const reason = (notes[a.id] ?? "").trim();
    if (status === "Declined" && !reason) {
      setErrors((e) => ({ ...e, [a.id]: "Say why, so the requester knows what to change." }));
      return;
    }
    setErrors((e) => ({ ...e, [a.id]: "" }));
    decideApproval(a.id, status, reason, userName);
    toast.show({ message: `${a.target} ${status.toLowerCase()}. ${a.by} is told.`, tone: status === "Approved" ? "success" : "info" });
  }

  const link = (a: DemoApproval) => (a.quoteDealId ? `/o/${orgSlug}/quotes/${a.quoteDealId}` : null);

  const panel = list.length === 0 ? (
    <EmptyState title={tab === "pending" ? "Nothing waiting for you." : "No decisions yet."} body={approver ? "New requests appear here when a rule needs a decision." : "Your requests and their outcomes appear here."} />
  ) : (
    <ul className="fb-com-list">
      {list.map((a) => {
        const pending = a.status === "Pending";
        const href = link(a);
        return (
          <li key={a.id} className="fb-com-card fb-com-approval">
            <span className={`fb-com-approval__icon${a.kind === "Deletion" ? " fb-com-approval__icon--danger" : ""}`}>{ICON[a.kind]}</span>
            <div className="fb-com-approval__main">
              <div className="fb-com-eyebrow">{a.kind} · requested by {a.by} · {whenLabel(a.at)}</div>
              <h2 className="fb-com-approval__target">{a.target}</h2>
              <p className="fb-com-muted">{a.detail}</p>
              {pending && approver ? (
                <label className="fb-com-reason">
                  <span className="fb-sr-only">Reason for {a.target}</span>
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
              {pending && approver ? (
                <>
                  {href ? <Link className="fb-btn fb-btn--secondary" href={href}>Open</Link> : null}
                  <Button variant="danger" onClick={() => decide(a, "Declined")}>Decline</Button>
                  <Button variant="primary" onClick={() => decide(a, "Approved")}>Approve</Button>
                </>
              ) : (
                <span className={`fb-com-pill fb-com-pill--${a.status === "Approved" ? "ok" : a.status === "Declined" ? "bad" : "warn"}`}>
                  {a.status === "Pending" ? "Waiting for Management" : a.status}
                  {a.reason ? ` · ${a.reason}` : ""}
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
      <Tabs
        label="Approval status"
        value={tab}
        onChange={(id) => setTab(id as "pending" | "done")}
        tabs={[
          { id: "pending", label: <>Waiting <span className="fb-com-count">{waiting.length}</span></>, panel },
          { id: "done", label: <>Decided <span className="fb-com-count">{decided.length}</span></>, panel },
        ]}
      />
      <p className="fb-sr-only" aria-live="polite">{list.length} requests shown</p>
    </div>
  );
}
