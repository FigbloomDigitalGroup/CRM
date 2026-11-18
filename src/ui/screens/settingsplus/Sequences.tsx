"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, LoadingState, useApiMutation, useApiQuery, useMember, useToast } from "@/ui";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { Switch } from "../settings/kit";
import { EditorFrame } from "./kit";
import { sequenceBody, sequenceImpact, validateSequences, type SequenceView, type StepView } from "./sequencesModel";

/**
 * Follow-up sequences (S6#2, FIG-1174), on `GET/POST/PATCH /sequences` (B6.18, docs/SEQUENCES.md): planned steps for new leads or deals. A step
 * creates a task or a prepared message for the owner; a reply or a logged call pauses the sequence. Rule 9: a sequence never moves a stage, sets
 * a discount or approves anything, and the editor offers no such step. The only step kinds are a task, a prepared email and (Management's
 * choice, approved template only) an email sent as the owner.
 */
type Kind = "TASK" | "DRAFT" | "SEND";
const kindOf = (s: StepView): Kind => (s.kind === "TASK" ? "TASK" : s.emailMode === "SEND" ? "SEND" : "DRAFT");

export function SequencesEditor() {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const q = useApiQuery("getSequences", { params: { orgSlug } });
  const templates = useApiQuery("getEmailTemplates", { params: { orgSlug } } as never, { retry: false });
  const create = useApiMutation("postSequences", { invalidate: [["getSequences"]] });
  const patch = useApiMutation("patchSequencesBySequenceId", { invalidate: [["getSequences"]] });
  const [draft, setDraft] = useState<SequenceView[] | null>(null);
  const mayEdit = can("cadences.manage");

  if (q.isLoading) return <LoadingState label="Loading sequences" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="Sequences" onRetry={() => void q.refetch()} />;

  const saved = (q.data as unknown as { items: SequenceView[] }).items;
  const rows = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const tpl = ((templates.data as unknown as { items?: { id: string; name: string }[] } | undefined)?.items ?? []);
  const errors = validateSequences(rows);
  const impact = sequenceImpact(saved, rows);
  const set = (id: string, p: Partial<SequenceView>) => setDraft(rows.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const setStep = (id: string, i: number, p: Partial<StepView>) => set(id, { steps: rows.find((s) => s.id === id)!.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setKind = (id: string, i: number, k: Kind) =>
    setStep(id, i, k === "TASK" ? { kind: "TASK", emailMode: "DRAFT", emailTemplateId: null } : { kind: "EMAIL", emailMode: k === "SEND" ? "SEND" : "DRAFT", emailTemplateId: rows.find((s) => s.id === id)!.steps[i]!.emailTemplateId });

  async function onSave() {
    try {
      for (const s of rows) {
        const was = saved.find((x) => x.id === s.id);
        if (!was) {
          const made = (await create.mutateAsync({ params: { orgSlug }, body: sequenceBody(s, true) } as never)) as unknown as { id: string };
          if (s.isActive) await patch.mutateAsync({ params: { orgSlug, sequenceId: made.id }, body: { isActive: true } } as never);
        } else if (JSON.stringify(was) !== JSON.stringify(s)) await patch.mutateAsync({ params: { orgSlug, sequenceId: s.id }, body: sequenceBody(s, false) } as never);
      }
      setDraft(null);
      return true;
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
      return false;
    }
  }

  return (
    <EditorFrame
      area="Sequences"
      title="Follow-up sequences"
      description="Planned follow-up steps for new leads and deals. They create tasks and prepared messages; they never move a deal or approve anything."
      release="v1.1"
      dirty={dirty}
      errors={errors}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management manages sequences"}
      actions={
        <Button
          disabled={!mayEdit}
          onClick={() => setDraft([...rows, { id: `new-${rows.length + 1}`, name: "New sequence", description: null, subjectType: "LEAD", trigger: "MANUAL", isActive: false, running: 0, steps: [{ position: 0, dayOffset: 0, kind: "TASK", title: "Call task", emailTemplateId: null, emailMode: "DRAFT", priority: "MEDIUM", description: null }] }])}
        >
          <Plus size={15} aria-hidden="true" /> New sequence
        </Button>
      }
      onDiscard={() => setDraft(null)}
      onSave={onSave}
    >
      {rows.length === 0 ? <p className="fb-set-muted">No sequences yet. Add one to plan follow-ups for new leads.</p> : null}
      {rows.map((s) => (
        <section key={s.id} className="fb-sp-seq" aria-label={s.name}>
          <div className="fb-sp-seq__head">
            <input className="fb-input fb-sp-seq__name" value={s.name} aria-label="Sequence name" readOnly={!mayEdit} onChange={(e) => set(s.id, { name: e.target.value })} />
            <span className="fb-set-muted">{s.subjectType === "LEAD" ? "Leads" : "Deals"} · {s.running} running</span>
            <span className="fb-sp-toggle"><Switch checked={s.isActive} label={`${s.name} ${s.isActive ? "on" : "paused"}`} disabled={!mayEdit} onChange={(on) => set(s.id, { isActive: on })} /> {s.isActive ? "On" : "Paused"}</span>
          </div>
          {s.subjectType === "LEAD" ? (
            <div className="fb-sp-toggle">
              <Switch checked={s.trigger === "WEBSITE_LEAD"} label={`${s.name} starts for every new website lead`} disabled={!mayEdit} onChange={(on) => set(s.id, { trigger: on ? "WEBSITE_LEAD" : "MANUAL" })} />
              <span>Start automatically for every new website lead</span>
            </div>
          ) : null}
          <ol className="fb-sp-steps">
            {s.steps.map((step, i) => (
              <li key={i}>
                <span className="fb-sp-steps__n">{i + 1}</span>
                <input className="fb-input" type="number" min={0} max={365} style={{ width: 72 }} value={step.dayOffset} aria-label={`Day of step ${i + 1} of ${s.name}`} readOnly={!mayEdit} onChange={(e) => setStep(s.id, i, { dayOffset: Number(e.target.value) })} />
                <select className="fb-input" value={kindOf(step)} aria-label={`Kind of step ${i + 1} of ${s.name}`} disabled={!mayEdit} onChange={(e) => setKind(s.id, i, e.target.value as Kind)}>
                  <option value="TASK">Task</option>
                  <option value="DRAFT">Prepared email</option>
                  <option value="SEND">Send approved email</option>
                </select>
                <input className="fb-input" value={step.title} aria-label={`Step ${i + 1} of ${s.name}`} readOnly={!mayEdit} onChange={(e) => setStep(s.id, i, { title: e.target.value })} />
                {step.kind === "EMAIL" ? (
                  <select className="fb-input" value={step.emailTemplateId ?? ""} aria-label={`Template for step ${i + 1} of ${s.name}`} disabled={!mayEdit} onChange={(e) => setStep(s.id, i, { emailTemplateId: e.target.value || null })}>
                    <option value="">Choose a template</option>
                    {tpl.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                ) : null}
                {mayEdit ? <IconButton label={`Remove step ${i + 1}`} onClick={() => set(s.id, { steps: s.steps.filter((_, j) => j !== i) })}><X size={14} aria-hidden="true" /></IconButton> : null}
              </li>
            ))}
          </ol>
          {mayEdit ? (
            <Button size="sm" onClick={() => set(s.id, { steps: [...s.steps, { position: s.steps.length, dayOffset: (s.steps.at(-1)?.dayOffset ?? 0) + 3, kind: "TASK", title: "Task", emailTemplateId: null, emailMode: "DRAFT", priority: "MEDIUM", description: null }] })}>
              <Plus size={14} aria-hidden="true" /> Add a step
            </Button>
          ) : null}
          <p className="fb-set-muted">A task or a prepared email waits for the owner. A step set to send uses an approved template as the owner and appears on the timeline. A reply or a logged call pauses the sequence.</p>
        </section>
      ))}
    </EditorFrame>
  );
}
