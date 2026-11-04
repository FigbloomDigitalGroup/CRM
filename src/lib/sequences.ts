/**
 * Follow-up sequences, the pure rules (FIG-1150, B6.18). No database, no clock of its own: every time is passed in, so the scheduler
 * tests run on a fake clock. The engine is `src/sequences/engine.ts`; the rules in words are in docs/SEQUENCES.md.
 *
 * THE BOUNDARY (CLAUDE.md rule 9): a sequence reminds people (a task), drafts an email for them (a task holding the text) or, when
 * Management chose SEND for an approved, active template, sends it and logs it on the timeline. Those are the only effects
 * (`SEQUENCE_EFFECTS`). A sequence never moves a deal stage, sets a discount, changes an owner, closes or approves anything;
 * `tests/followUpSequences.test.ts` scans the sequence code for those fields and checks a full run leaves them untouched.
 */

export const SUBJECT_TYPES = ["LEAD", "DEAL"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const TRIGGERS = ["MANUAL", "WEBSITE_LEAD"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const STEP_KINDS = ["TASK", "EMAIL"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const EMAIL_MODES = ["DRAFT", "SEND"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const EXIT_RULES = ["CLOSED", "ARCHIVED"] as const;
export type ExitRule = (typeof EXIT_RULES)[number];

/** Everything a sequence can do to the world. Nothing else is written by sequence code. */
export const SEQUENCE_EFFECTS = ["CREATE_TASK", "SEND_APPROVED_TEMPLATE"] as const;

export const MAX_STEPS = 12;
export const MAX_SEQUENCES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EnrollmentStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "EXITED";
export type PauseReason = "REPLY" | "MANUAL";
export type EndReason = "COMPLETED" | "LEAD_CLOSED" | "DEAL_CLOSED" | "ARCHIVED" | "MANUAL" | "SEQUENCE_REMOVED";

export interface StepInput {
  position: number;
  dayOffset: number;
  kind: StepKind;
  title: string;
  description: string | null;
  priority: (typeof PRIORITIES)[number];
  emailTemplateId: string | null;
  emailMode: EmailMode;
}

export interface Problem {
  path: string;
  message: string;
}

/** Checks and cleans a sequence's steps: 1 to 12, days from 0 to 365 never going backwards, an approved template for each email. */
export function cleanSteps(input: unknown): { steps: StepInput[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const steps: StepInput[] = [];
  if (!Array.isArray(input)) return { steps, problems: [{ path: "steps", message: "steps is a list." }] };
  if (input.length === 0 || input.length > MAX_STEPS) problems.push({ path: "steps", message: `A sequence has 1 to ${MAX_STEPS} steps.` });
  let previousDay = 0;
  input.slice(0, MAX_STEPS + 1).forEach((raw, i) => {
    const at = `steps.${i}`;
    const s = (raw ?? {}) as Record<string, unknown>;
    const kind = s.kind;
    const day = s.dayOffset;
    const title = typeof s.title === "string" ? s.title.trim().replace(/\s+/g, " ") : "";
    if (!(STEP_KINDS as readonly unknown[]).includes(kind)) problems.push({ path: `${at}.kind`, message: `kind is one of ${STEP_KINDS.join(", ")}.` });
    if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 365) problems.push({ path: `${at}.dayOffset`, message: "dayOffset is a whole number of days from 0 to 365." });
    else if (day < previousDay) problems.push({ path: `${at}.dayOffset`, message: "Steps run in order: this day is earlier than the step before." });
    if (typeof day === "number") previousDay = Math.max(previousDay, day);
    if (!title || title.length > 100) problems.push({ path: `${at}.title`, message: "A title of 1 to 100 characters is required." });
    const description = typeof s.description === "string" && s.description.trim() ? s.description.trim() : null;
    if (description && description.length > 2000) problems.push({ path: `${at}.description`, message: "A description is at most 2,000 characters." });
    const priority = s.priority === undefined ? "MEDIUM" : s.priority;
    if (!(PRIORITIES as readonly unknown[]).includes(priority)) problems.push({ path: `${at}.priority`, message: `priority is one of ${PRIORITIES.join(", ")}.` });
    const emailMode = s.emailMode === undefined ? "DRAFT" : s.emailMode;
    if (!(EMAIL_MODES as readonly unknown[]).includes(emailMode)) problems.push({ path: `${at}.emailMode`, message: "emailMode is DRAFT or SEND." });
    const emailTemplateId = typeof s.emailTemplateId === "string" && s.emailTemplateId ? s.emailTemplateId : null;
    if (kind === "EMAIL" && !emailTemplateId) problems.push({ path: `${at}.emailTemplateId`, message: "An email step needs an email template." });
    if (kind === "TASK" && (emailTemplateId || s.emailMode === "SEND")) problems.push({ path: `${at}.kind`, message: "A task step has no template and cannot send." });
    steps.push({
      position: i,
      dayOffset: typeof day === "number" ? day : 0,
      kind: kind as StepKind,
      title,
      description,
      priority: priority as StepInput["priority"],
      emailTemplateId: kind === "EMAIL" ? emailTemplateId : null,
      emailMode: kind === "EMAIL" ? (emailMode as EmailMode) : "DRAFT",
    });
  });
  return { steps, problems };
}

export const dueAt = (enrolledAt: Date, dayOffset: number): Date => new Date(enrolledAt.getTime() + dayOffset * DAY_MS);

/** When a resumed enrolment's next step is due: it keeps the gap it had to the step before, counted from now. */
export function resumeAt(now: Date, previousDayOffset: number | null, nextDayOffset: number): Date {
  const gap = previousDayOffset === null ? 0 : Math.max(0, nextDayOffset - previousDayOffset);
  return new Date(now.getTime() + gap * DAY_MS);
}

/** A lead is closed when it was converted or has a closing status. */
export const CLOSED_LEAD_STATUS_KEYS = ["CONVERTED", "LOST", "UNQUALIFIED", "INACTIVE"] as const;
export function leadIsClosed(lead: { statusKey: string | null; convertedAt: Date | null }): boolean {
  return lead.convertedAt !== null || (lead.statusKey !== null && (CLOSED_LEAD_STATUS_KEYS as readonly string[]).includes(lead.statusKey));
}
export const dealIsClosed = (deal: { outcome: string }): boolean => deal.outcome !== "OPEN";

/** Why an enrolment on this record should end now, or null when it carries on. */
export function exitReasonFor(
  subject: { type: SubjectType; archivedAt: Date | null; closed: boolean },
  exitRules: readonly string[],
): EndReason | null {
  if (subject.archivedAt && exitRules.includes("ARCHIVED")) return "ARCHIVED";
  if (subject.closed && exitRules.includes("CLOSED")) return subject.type === "LEAD" ? "LEAD_CLOSED" : "DEAL_CLOSED";
  return null;
}
