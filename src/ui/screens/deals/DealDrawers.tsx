"use client";

import { CheckCircle2, Mail, MessageCircle, Phone, Plus, StickyNote, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useApi } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useRefreshDeals } from "./data";
import { DealModal } from "./Modal";
import { SideDrawer } from "./SideDrawer";

/** Log activity, Add task and Add proposal reference, as the design draws them, posting to the real endpoints for one deal. */

const KINDS: { type: "CALL" | "WHATSAPP" | "EMAIL" | "MEETING" | "NOTE"; label: string; Icon: LucideIcon }[] = [
  { type: "CALL", label: "Call", Icon: Phone },
  { type: "WHATSAPP", label: "WhatsApp", Icon: MessageCircle },
  { type: "EMAIL", label: "Email", Icon: Mail },
  { type: "MEETING", label: "Meeting", Icon: Users },
  { type: "NOTE", label: "Note", Icon: StickyNote },
];
const OUTCOMES = ["Reached", "No answer", "Interested", "Not now", "Asked for quote"];
const WHEN = [
  { id: "tomorrow", label: "Tomorrow", days: 1 },
  { id: "3days", label: "In 3 days", days: 3 },
  { id: "week", label: "Next week", days: 7 },
];

function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export function LogActivityDrawer({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const api = useApi();
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const [kind, setKind] = useState<(typeof KINDS)[number]["type"]>("CALL");
  const [outcome, setOutcome] = useState("");
  const [text, setText] = useState("");
  const [next, setNext] = useState("");
  const [when, setWhen] = useState("tomorrow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.call("postActivities", {
        params: { orgSlug },
        body: { type: kind, dealId, subject: `${KINDS.find((k) => k.type === kind)!.label}${outcome ? ` · ${outcome}` : ""}`, description: text.trim() || undefined, outcome: outcome || undefined },
        idempotencyKey: newIdempotencyKey(),
      } as never);
      if (next.trim()) {
        await api.call("postTasks", { params: { orgSlug }, body: { title: next.trim(), dealId, dueAt: inDays(WHEN.find((w) => w.id === when)!.days) }, idempotencyKey: newIdempotencyKey() });
      }
      refresh();
      toast.show({ tone: "success", message: next.trim() ? "Logged, and your next action is on your task list." : "Logged." });
      onClose();
    } catch (e) {
      const d = describeError(e);
      setError(d.kind === "validation" || d.kind === "conflict" || d.kind === "noAccess" ? d.body : "That was not saved. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideDrawer
      title="Log a call or note"
      sub="A line and one next action. That’s it."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={busy} onClick={() => void save()}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            Log it
          </button>
        </>
      }
    >
      <div className="fb-dm__field" role="group" aria-labelledby="fb-log-what">
        <span id="fb-log-what">What happened?</span>
        <div className="fb-dchips">
          {KINDS.map(({ type, label, Icon }) => (
            <button key={type} type="button" className="fb-dchip fb-dchip--lg" aria-pressed={kind === type} onClick={() => setKind(type)}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="fb-dm__field" role="group" aria-labelledby="fb-log-outcome">
        <span id="fb-log-outcome">Outcome</span>
        <div className="fb-dchips">
          {OUTCOMES.map((o) => (
            <button key={o} type="button" className="fb-dchip" aria-pressed={outcome === o} onClick={() => setOutcome(outcome === o ? "" : o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
      <label className="fb-dm__field">
        <span>Note</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={3} value={text} placeholder="One line is enough." onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="fb-dnext">
        <span className="fb-dnext__h">
          <CheckCircle2 size={16} aria-hidden="true" />
          One next action
        </span>
        <input className="fb-dm__input" aria-label="Next action" value={next} placeholder="e.g. Send revised quote" onChange={(e) => setNext(e.target.value)} />
        <div className="fb-dchips">
          {WHEN.map((w) => (
            <button key={w.id} type="button" className="fb-dchip fb-dchip--sm" aria-pressed={when === w.id} onClick={() => setWhen(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="fb-dm__error">
          {error}
        </p>
      ) : null}
    </SideDrawer>
  );
}

export function AddTaskDrawer({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const api = useApi();
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const [f, setF] = useState({ title: "", description: "", due: "", priority: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.call("postTasks", {
        params: { orgSlug },
        body: { title: f.title.trim(), dealId, priority: f.priority, ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.due ? { dueAt: new Date(f.due).toISOString() } : {}) },
        idempotencyKey: newIdempotencyKey(),
      });
      refresh();
      toast.show({ tone: "success", message: "Task created." });
      onClose();
    } catch (e) {
      const d = describeError(e);
      setError(d.kind === "validation" || d.kind === "conflict" || d.kind === "noAccess" ? d.body : "The task was not created. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SideDrawer
      title="New task"
      sub="Who does what, by when."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={!f.title.trim() || busy} onClick={() => void save()}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            Create task
          </button>
        </>
      }
    >
      <label className="fb-dm__field">
        <span>
          Title <span className="fb-dd__req" aria-hidden="true">*</span>
        </span>
        <input className="fb-dm__input" value={f.title} placeholder="What needs doing?" required onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <label className="fb-dm__field">
        <span>Description</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={3} value={f.description} placeholder="Details, links, next steps..." onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <label className="fb-dm__field">
        <span>Due</span>
        <input type="datetime-local" className="fb-dm__input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
      </label>
      <div className="fb-dm__field" role="group" aria-labelledby="fb-task-prio">
        <span id="fb-task-prio">Priority</span>
        <div className="fb-dprio">
          {(["LOW", "MEDIUM", "HIGH"] as const).map((p) => (
            <button key={p} type="button" className="fb-dchip fb-dchip--block" aria-pressed={f.priority === p} onClick={() => setF({ ...f, priority: p })}>
              {p[0] + p.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="fb-dm__error">
          {error}
        </p>
      ) : null}
    </SideDrawer>
  );
}

export function AddProposalDialog({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const api = useApi();
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const [f, setF] = useState({ number: "", amount: "", doc: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.call("postDealsByDealIdProposals", {
        params: { orgSlug, dealId },
        body: { proposalNumber: f.number.trim(), ...(f.amount ? { amount: Number(f.amount), currency: "KES" } : {}), ...(f.doc.trim() ? { documentReference: f.doc.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) },
        idempotencyKey: newIdempotencyKey(),
      });
      refresh();
      toast.show({ tone: "success", message: "Proposal reference added." });
      onClose();
    } catch (e) {
      const d = describeError(e);
      setError(d.kind === "validation" || d.kind === "conflict" || d.kind === "noAccess" ? d.body : "The proposal was not saved. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DealModal
      title="Add a proposal reference"
      lead="Documents live in Drive; store the reference here."
      onClose={onClose}
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={!f.number.trim() || busy} onClick={() => void save()}>
            Add proposal
          </button>
        </>
      }
    >
      <div className="fb-dm__grid2">
        <label className="fb-dm__field">
          <span>Proposal number</span>
          <input className="fb-dm__input" value={f.number} placeholder="P-2026-015" onChange={(e) => setF({ ...f, number: e.target.value })} />
        </label>
        <label className="fb-dm__field">
          <span>Amount (KES)</span>
          <input type="number" min="0" className="fb-dm__input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </label>
      </div>
      <label className="fb-dm__field">
        <span>Document (Drive path or link)</span>
        <input className="fb-dm__input" value={f.doc} placeholder="Drive / Proposals / …" onChange={(e) => setF({ ...f, doc: e.target.value })} />
      </label>
      <label className="fb-dm__field">
        <span>Notes</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      {error ? (
        <p role="alert" className="fb-dm__error">
          {error}
        </p>
      ) : null}
    </DealModal>
  );
}
