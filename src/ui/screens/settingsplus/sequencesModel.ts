/**
 * Sequences editor model (FIG-1174, B6.18): the shapes `GET /sequences` returns (the contract types them as `unknown`; from `presentSequence` in
 * `src/services/followUpService.ts`), the local checks that mirror the server's step rules, and the request body. Pure, so it is tested alone.
 */

export interface StepView {
  position: number;
  dayOffset: number;
  kind: "TASK" | "EMAIL";
  title: string;
  description: string | null;
  priority: string;
  emailTemplateId: string | null;
  emailMode: "DRAFT" | "SEND";
}

export interface SequenceView {
  id: string;
  name: string;
  description: string | null;
  subjectType: "LEAD" | "DEAL";
  trigger: "MANUAL" | "WEBSITE_LEAD";
  isActive: boolean;
  running: number;
  steps: StepView[];
}

export function validateSequences(rows: readonly SequenceView[]): string[] {
  const errors: string[] = [];
  for (const s of rows) {
    const who = s.name.trim() || "Sequence";
    if (!s.name.trim()) errors.push(`${who}: give the sequence a name.`);
    if (s.steps.length === 0) errors.push(`${who}: a sequence needs at least one step.`);
    if (s.steps.length > 12) errors.push(`${who}: a sequence has 12 steps at most.`);
    let previous = 0;
    s.steps.forEach((st, i) => {
      if (!st.title.trim()) errors.push(`${who}: step ${i + 1} is empty.`);
      if (!Number.isInteger(st.dayOffset) || st.dayOffset < 0 || st.dayOffset > 365) errors.push(`${who}: step ${i + 1} day must be a whole number from 0 to 365.`);
      else if (st.dayOffset < previous) errors.push(`${who}: step ${i + 1} is earlier than the step before. Steps run in order.`);
      previous = Math.max(previous, st.dayOffset);
      if (st.kind === "EMAIL" && !st.emailTemplateId) errors.push(`${who}: step ${i + 1} needs an email template.`);
    });
    if (s.isActive && s.steps.length === 0) errors.push(`${who}: add a step before switching it on.`);
  }
  return errors;
}

export function sequenceImpact(saved: readonly SequenceView[], draft: readonly SequenceView[]): string[] {
  return draft.flatMap((s) => {
    const was = saved.find((x) => x.id === s.id);
    if (!was) return [`“${s.name}” is added. It starts for new records only.`];
    const out: string[] = [];
    if (was.isActive !== s.isActive) {
      out.push(s.isActive ? `“${s.name}” resumes: ${s.running} running enrolment${s.running === 1 ? "" : "s"} get their next step.` : `“${s.name}” pauses: no new tasks for ${s.running} running enrolment${s.running === 1 ? "" : "s"}. Anything already prepared stays.`);
    }
    if (JSON.stringify(was.steps) !== JSON.stringify(s.steps)) out.push(`“${s.name}” has ${s.steps.length} steps (was ${was.steps.length}). Records already in it continue with the new plan from their current step.`);
    if (was.trigger !== s.trigger) out.push(s.trigger === "WEBSITE_LEAD" ? `“${s.name}” will start for every new website lead.` : `“${s.name}” will no longer start by itself.`);
    return out;
  });
}

export function sequenceBody(s: SequenceView, isNew: boolean) {
  const steps = s.steps.map((st) => ({
    dayOffset: st.dayOffset,
    kind: st.kind,
    title: st.title.trim(),
    description: st.description,
    priority: st.priority,
    emailTemplateId: st.kind === "EMAIL" ? st.emailTemplateId : null,
    emailMode: st.kind === "EMAIL" ? st.emailMode : "DRAFT",
  }));
  return isNew
    ? { name: s.name.trim(), subjectType: s.subjectType, trigger: s.trigger, steps }
    : { name: s.name.trim(), isActive: s.isActive, trigger: s.trigger, steps };
}
