"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, useMember } from "@/ui";
import { Switch } from "../settings/kit";
import { sequences as seed, type DemoSequence } from "./demo/data";
import { EditorFrame, recordAudit } from "./kit";
import { validateSequence } from "./model";

/**
 * Follow-up sequences (S6#2, FIG-1174): planned steps for new leads. A step creates a task or a prepared message for the owner; nothing is sent
 * without them, and a reply or a logged call pauses the sequence. Pausing never recalls anything already sent.
 */
export function SequencesEditor() {
  const { userName, can } = useMember();
  const [saved, setSaved] = useState<DemoSequence[]>(seed);
  const [draft, setDraft] = useState<DemoSequence[]>(seed);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const errors = draft.flatMap((s) => validateSequence(s.name, s.steps).map((m) => `${s.name || "Sequence"}: ${m}`));
  const impact = draft.flatMap((s) => {
    const was = saved.find((x) => x.id === s.id);
    if (!was) return [`“${s.name}” is added. It starts for new leads only.`];
    const out: string[] = [];
    if (was.on !== s.on) out.push(s.on ? `“${s.name}” resumes: ${s.active} enrolled lead${s.active === 1 ? "" : "s"} get their next step.` : `“${s.name}” pauses: no new tasks for ${s.active} enrolled lead${s.active === 1 ? "" : "s"}. Anything already prepared stays.`);
    if (JSON.stringify(was.steps) !== JSON.stringify(s.steps)) out.push(`“${s.name}” has ${s.steps.length} steps (was ${was.steps.length}). Leads already in it continue with the new plan from their current step.`);
    return out;
  });
  const patch = (id: string, p: Partial<DemoSequence>) => setDraft(draft.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const mayEdit = can("cadences.manage");

  return (
    <EditorFrame
      area="Sequences"
      title="Follow-up sequences"
      description="Planned follow-up steps for new leads. They create tasks and prepared messages; they never send on their own."
      release="v1.1"
      dirty={dirty}
      errors={errors}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management manages sequences"}
      actions={<Button disabled={!mayEdit} onClick={() => setDraft([...draft, { id: `cd${draft.length + 1}`, name: "New sequence", active: 0, on: false, steps: ["Day 0 · Call task"] }])}><Plus size={15} aria-hidden="true" /> New sequence</Button>}
      onDiscard={() => setDraft(saved)}
      onSave={() => {
        recordAudit("Sequences", "Sequences changed", impact.join(" "), userName);
        setSaved(draft);
      }}
    >
      {draft.map((s) => (
        <section key={s.id} className="fb-sp-seq" aria-label={s.name}>
          <div className="fb-sp-seq__head">
            <input className="fb-input fb-sp-seq__name" value={s.name} aria-label="Sequence name" readOnly={!mayEdit} onChange={(e) => patch(s.id, { name: e.target.value })} />
            <span className="fb-set-muted">{s.active} leads enrolled</span>
            <span className="fb-sp-toggle"><Switch checked={s.on} label={`${s.name} ${s.on ? "on" : "paused"}`} disabled={!mayEdit} onChange={(on) => patch(s.id, { on })} /> {s.on ? "On" : "Paused"}</span>
          </div>
          <ol className="fb-sp-steps">
            {s.steps.map((step, i) => (
              <li key={i}>
                <span className="fb-sp-steps__n">{i + 1}</span>
                <input className="fb-input" value={step} aria-label={`Step ${i + 1} of ${s.name}`} readOnly={!mayEdit} onChange={(e) => patch(s.id, { steps: s.steps.map((x, j) => (j === i ? e.target.value : x)) })} />
                {mayEdit ? <IconButton label={`Remove step ${i + 1}`} onClick={() => patch(s.id, { steps: s.steps.filter((_, j) => j !== i) })}><X size={14} aria-hidden="true" /></IconButton> : null}
              </li>
            ))}
          </ol>
          {mayEdit ? <Button size="sm" onClick={() => patch(s.id, { steps: [...s.steps, `Day ${s.steps.length * 3} · Task`] })}><Plus size={14} aria-hidden="true" /> Add a step</Button> : null}
          <p className="fb-set-muted">Each step creates a task or a prepared message for the owner. Nothing is sent without them. A reply or a logged call pauses the sequence.</p>
        </section>
      ))}
    </EditorFrame>
  );
}
