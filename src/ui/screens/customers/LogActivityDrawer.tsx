"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { Icon } from "../leads/icons";
import { SideDrawer } from "../leads/overlay";

const KINDS = [
  { v: "CALL", l: "Call", icon: "phone" },
  { v: "WHATSAPP", l: "WhatsApp", icon: "whatsapp" },
  { v: "EMAIL", l: "Email", icon: "mail" },
  { v: "MEETING", l: "Meeting", icon: "users" },
  { v: "NOTE", l: "Note", icon: "note" },
] as const;
const OUTCOMES = ["Reached", "No answer", "Interested", "Not now", "Asked for quote"];
const WHEN = [
  { v: "tomorrow", l: "Tomorrow", days: 1 },
  { v: "3days", l: "In 3 days", days: 3 },
  { v: "week", l: "Next week", days: 7 },
];

/** "Log a call or note" on a company (the design's note drawer): what happened, the outcome, one line and one next action that becomes a task. */
export function LogActivityDrawer({ companyId, about, onClose }: { companyId: string; about: string; onClose: () => void }) {
  const { orgSlug, membershipId, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<(typeof KINDS)[number]["v"]>("NOTE");
  const [outcome, setOutcome] = useState("");
  const [text, setText] = useState("");
  const [nextTitle, setNextTitle] = useState("");
  const [when, setWhen] = useState("tomorrow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const k = KINDS.find((x) => x.v === kind)!;
      await api.call("postActivities", { params: { orgSlug }, idempotencyKey: newIdempotencyKey(), body: { type: k.v, subject: k.l, description: text.trim() || undefined, outcome: outcome || undefined, companyId } } as never);
      if (nextTitle.trim() && can("tasks.create")) {
        const due = new Date();
        due.setDate(due.getDate() + (WHEN.find((w) => w.v === when)?.days ?? 1));
        due.setHours(10, 0, 0, 0);
        await api.call("postTasks", { params: { orgSlug }, idempotencyKey: newIdempotencyKey(), body: { title: nextTitle.trim(), dueAt: due.toISOString(), companyId, assigneeMembershipId: membershipId } } as never);
      }
      toast.show({ tone: "success", message: "Logged" });
      await qc.invalidateQueries({ queryKey: ["getCustomer360"] });
      onClose();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideDrawer
      title="Log a call or note"
      subtitle="A line and one next action. That’s it."
      onClose={onClose}
      label="Log a call or note"
      footer={
        <>
          <button type="button" className="fb-ld-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={busy || (!text.trim() && !outcome && !nextTitle.trim())} onClick={save}>
            <Icon name="plus" size={16} stroke={2.2} />
            Log it
          </button>
        </>
      }
    >
      <div className="fb-ld-field">
        <span id="fb-cu-kind" className="fb-ld-label">
          What happened?
        </span>
        <div className="fb-ld-reasons" role="group" aria-labelledby="fb-cu-kind">
          {KINDS.map((k) => (
            <button key={k.v} type="button" className="fb-ld-reason fb-ld-reason--on-primary" aria-pressed={kind === k.v} onClick={() => setKind(k.v)} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Icon name={k.icon} size={15} />
              {k.l}
            </button>
          ))}
        </div>
      </div>
      <div className="fb-ld-field">
        <span className="fb-ld-label">About</span>
        <input className="fb-ld-input" value={about} readOnly aria-label="About" />
      </div>
      <div className="fb-ld-field">
        <span id="fb-cu-outcome" className="fb-ld-label">
          Outcome
        </span>
        <div className="fb-ld-reasons" role="group" aria-labelledby="fb-cu-outcome">
          {OUTCOMES.map((o) => (
            <button key={o} type="button" className="fb-ld-reason fb-ld-reason--on-primary" aria-pressed={outcome === o} onClick={() => setOutcome(outcome === o ? "" : o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
      <label className="fb-ld-field">
        <span>Note</span>
        <textarea className="fb-ld-textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="One line is enough." />
      </label>
      {can("tasks.create") ? (
        <div style={{ padding: 14, borderRadius: 12, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "var(--orange)", display: "flex" }}>
              <Icon name="arrow-circle" size={16} />
            </span>
            One next action
          </span>
          <input className="fb-ld-input" aria-label="Next action" value={nextTitle} onChange={(e) => setNextTitle(e.target.value)} placeholder="e.g. Send revised quote" />
          <div className="fb-ld-pills" role="group" aria-label="When">
            {WHEN.map((w) => (
              <button key={w.v} type="button" className="fb-ld-pill" aria-pressed={when === w.v} onClick={() => setWhen(w.v)}>
                {w.l}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </SideDrawer>
  );
}
