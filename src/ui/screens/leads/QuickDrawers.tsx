"use client";

import { useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { useReference, useRefreshLeads } from "./data";
import { Icon } from "./icons";
import { SideDrawer } from "./overlay";

export type CommKind = "call" | "whatsapp" | "email" | "meeting" | "social" | "note";
const KINDS: { v: CommKind; l: string; icon: string; type: "CALL" | "WHATSAPP" | "EMAIL" | "MEETING" | "NOTE" | "OTHER" }[] = [
  { v: "call", l: "Call", icon: "phone", type: "CALL" },
  { v: "whatsapp", l: "WhatsApp", icon: "whatsapp", type: "WHATSAPP" },
  { v: "email", l: "Email", icon: "mail", type: "EMAIL" },
  { v: "meeting", l: "Meeting", icon: "users", type: "MEETING" },
  { v: "social", l: "Social DM", icon: "message", type: "OTHER" },
  { v: "note", l: "Note", icon: "note", type: "NOTE" },
];
const OUTCOMES = ["Reached", "No answer", "Interested", "Not now", "Asked for quote"];
const WHEN: { v: string; l: string; days: number }[] = [
  { v: "tomorrow", l: "Tomorrow", days: 1 },
  { v: "3days", l: "In 3 days", days: 3 },
  { v: "week", l: "Next week", days: 7 },
];

function Chip({ on, onClick, children, tone }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: "red" }) {
  return (
    <button type="button" className={`fb-ld-reason fb-ld-reason--on-primary`} aria-pressed={on} onClick={onClick} style={tone === "red" ? undefined : undefined}>
      {children}
    </button>
  );
}

/** "Log a call or note" (the design's note drawer): what happened, the outcome, one line, and one next action that becomes a task. */
export function NoteDrawer({ leadId, about, kind: initial = "note", onClose }: { leadId: string; about: string; kind?: CommKind; onClose: () => void }) {
  const { orgSlug, membershipId } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshLeads();
  const [kind, setKind] = useState<CommKind>(initial);
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
      await api.call("postActivities", {
        params: { orgSlug },
        idempotencyKey: newIdempotencyKey(),
        body: { type: k.type, subject: k.l, description: text.trim() || undefined, outcome: outcome || undefined, leadId },
      });
      if (nextTitle.trim()) {
        const days = WHEN.find((w) => w.v === when)?.days ?? 1;
        const due = new Date();
        due.setDate(due.getDate() + days);
        due.setHours(10, 0, 0, 0);
        await api.call("postTasks", { params: { orgSlug }, idempotencyKey: newIdempotencyKey(), body: { title: nextTitle.trim(), dueAt: due.toISOString(), leadId, assigneeMembershipId: membershipId } });
      }
      toast.show({ message: "Logged" });
      await refresh();
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
        <span id="fb-ld-kind" className="fb-ld-label">
          What happened?
        </span>
        <div className="fb-ld-reasons" role="group" aria-labelledby="fb-ld-kind">
          {KINDS.map((k) => (
            <button key={k.v} type="button" className="fb-ld-reason fb-ld-reason--on-primary" aria-pressed={kind === k.v} onClick={() => setKind(k.v)} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, fontSize: 13.5 }}>
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
        <span id="fb-ld-outcome" className="fb-ld-label">
          Outcome
        </span>
        <div className="fb-ld-reasons" role="group" aria-labelledby="fb-ld-outcome">
          {OUTCOMES.map((o) => (
            <Chip key={o} on={outcome === o} onClick={() => setOutcome(outcome === o ? "" : o)}>
              {o}
            </Chip>
          ))}
        </div>
      </div>
      <label className="fb-ld-field">
        <span>Note</span>
        <textarea className="fb-ld-textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="One line is enough." />
      </label>
      <div style={{ padding: 14, borderRadius: 12, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#ff9400", display: "flex" }}>
            <Icon name="arrow-circle" size={16} />
          </span>
          One next action
        </span>
        <input className="fb-ld-input" aria-label="Next action" value={nextTitle} onChange={(e) => setNextTitle(e.target.value)} placeholder="e.g. Send revised quote" />
        <div className="fb-ld-pills" role="group" aria-label="When">
          {WHEN.map((w) => (
            <button key={w.v} type="button" className="fb-ld-pill" aria-pressed={when === w.v} onClick={() => setWhen(w.v)} style={when === w.v ? { background: "var(--primary-soft)", color: "var(--primary-text)", borderColor: "var(--primary)" } : undefined}>
              {w.l}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </SideDrawer>
  );
}

/** "New task" from a lead (the design's task drawer): what, details, when, priority, who. It is linked to the lead. */
export function TaskDrawer({ leadId, about, onClose }: { leadId: string; about: string; onClose: () => void }) {
  const { orgSlug, membershipId, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const ref = useReference();
  const refresh = useRefreshLeads();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");
  const [assignee, setAssignee] = useState(membershipId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = !can("tasks.assign.any");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.call("postTasks", {
        params: { orgSlug },
        idempotencyKey: newIdempotencyKey(),
        body: {
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(due ? { dueAt: new Date(due).toISOString() } : {}),
          priority,
          leadId,
          assigneeMembershipId: assignee,
        },
      });
      toast.show({ message: "Task created" });
      await refresh();
      onClose();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideDrawer
      title="New task"
      subtitle="Who does what, by when."
      onClose={onClose}
      label="New task"
      footer={
        <>
          <button type="button" className="fb-ld-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={!title.trim() || busy} onClick={save}>
            <Icon name="plus" size={16} stroke={2.2} />
            Create task
          </button>
        </>
      }
    >
      <label className="fb-ld-field">
        <span>
          Title <span className="fb-ld-req" aria-hidden="true">*</span>
        </span>
        <input className="fb-ld-input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" required aria-required="true" />
      </label>
      <label className="fb-ld-field">
        <span>Description</span>
        <textarea className="fb-ld-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, links, next steps..." />
      </label>
      <label className="fb-ld-field">
        <span>Due</span>
        <input className="fb-ld-input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <div className="fb-ld-field">
        <span id="fb-ld-prio" className="fb-ld-label">
          Priority
        </span>
        <div className="fb-ld-temps fb-ld-temps--lg" role="group" aria-labelledby="fb-ld-prio">
          {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)} style={priority === p ? { background: "var(--primary-soft)", color: "var(--primary-text)", borderColor: "var(--primary-text)" } : undefined}>
              {p[0] + p.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      <label className="fb-ld-field">
        <span>Assignee</span>
        <select className="fb-ld-select" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={locked}>
          {ref.owners.map((o) => (
            <option key={o.membershipId} value={o.membershipId}>
              {o.name}
            </option>
          ))}
          {!ref.owners.some((o) => o.membershipId === membershipId) ? <option value={membershipId}>You</option> : null}
        </select>
        {locked ? (
          <span className="fb-ld-help">
            <Icon name="lock" size={12} />
            You can assign tasks to yourself. Management can assign to anyone.
          </span>
        ) : null}
      </label>
      <label className="fb-ld-field">
        <span>Linked record</span>
        <input className="fb-ld-input" value={about} readOnly aria-label="Linked record" />
      </label>
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </SideDrawer>
  );
}
