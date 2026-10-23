/**
 * Deal rules (FIG-1035, B2.06): when a deal counts as stalled, when its close
 * date has passed, and what blocks a move between stages. Pure functions; the
 * pipeline never moves a deal on its own, these only describe and validate.
 */

export const DEFAULT_STALLED_DAYS = 10;
export const MIN_STALLED_DAYS = 1;
export const MAX_STALLED_DAYS = 365;

/** How long a move can be undone: ten minutes. */
export const MOVE_UNDO_WINDOW_MS = 10 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

export interface DealSignalsInput {
  now: Date;
  outcome: "OPEN" | "WON" | "LOST";
  lastActivityAt: Date;
  expectedCloseDate: Date | null;
  /** The stage's own threshold, else the organisation default. */
  stalledAfterDays: number;
}

export interface DealSignals {
  /** Open, and nothing has happened for longer than the stage's threshold. */
  stalled: boolean;
  daysSinceActivity: number;
  stalledAfterDays: number;
  /** Open, with an expected close date that is before today. */
  closeDatePassed: boolean;
  /** Whole days past the close date; 0 when it has not passed. */
  closeDateOverdueDays: number;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function dealSignals(input: DealSignalsInput): DealSignals {
  const open = input.outcome === "OPEN";
  const daysSinceActivity = Math.max(0, Math.floor((input.now.getTime() - input.lastActivityAt.getTime()) / DAY));
  const stalled = open && input.now.getTime() - input.lastActivityAt.getTime() > input.stalledAfterDays * DAY;
  let overdueDays = 0;
  if (open && input.expectedCloseDate) {
    overdueDays = Math.max(0, Math.floor((startOfDay(input.now) - startOfDay(input.expectedCloseDate)) / DAY));
  }
  return {
    stalled,
    daysSinceActivity,
    stalledAfterDays: input.stalledAfterDays,
    closeDatePassed: overdueDays > 0,
    closeDateOverdueDays: overdueDays,
  };
}

export type MoveBlockerCode =
  | "DEAL_ARCHIVED"
  | "NOT_ALLOWED"
  | "STAGE_NOT_FOUND"
  | "STAGE_INACTIVE"
  | "SAME_STAGE"
  | "LOST_REASON_REQUIRED"
  | "LOST_REASON_UNKNOWN"
  | "REOPEN_NOT_ALLOWED";

export interface MoveBlocker {
  code: MoveBlockerCode;
  message: string;
  /** The request field to fix, when there is one. */
  field?: string;
}

export interface StageLike {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
  isActive: boolean;
}

export interface MoveCheckInput {
  from: StageLike;
  to: StageLike | null;
  fromOutcome: "OPEN" | "WON" | "LOST";
  archived: boolean;
  canEdit: boolean;
  /** Management may reopen a closed deal; others may not (the handoff of a won deal depends on it). */
  canReopen: boolean;
  lostReasonId: string | null | undefined;
  lostReasonKnown: boolean;
}

/** What blocks this move, each with a code the Move to dialog can show. Empty means it may go ahead. */
export function checkMove(input: MoveCheckInput): MoveBlocker[] {
  const blockers: MoveBlocker[] = [];
  if (input.archived) {
    blockers.push({ code: "DEAL_ARCHIVED", message: "This deal is archived. Restore it before moving it." });
    return blockers;
  }
  if (!input.canEdit) {
    blockers.push({ code: "NOT_ALLOWED", message: "You can move only deals you own." });
    return blockers;
  }
  if (!input.to) {
    blockers.push({ code: "STAGE_NOT_FOUND", message: "That pipeline stage does not exist.", field: "pipelineStageId" });
    return blockers;
  }
  if (!input.to.isActive) {
    blockers.push({ code: "STAGE_INACTIVE", message: `${input.to.name} is no longer in use.`, field: "pipelineStageId" });
  }
  if (input.to.id === input.from.id) {
    blockers.push({ code: "SAME_STAGE", message: "The deal is already in that stage.", field: "pipelineStageId" });
  }
  const reopening = input.fromOutcome !== "OPEN" && !input.to.isWon && !input.to.isLost;
  if (reopening && !input.canReopen) {
    blockers.push({
      code: "REOPEN_NOT_ALLOWED",
      message: `A ${input.fromOutcome === "WON" ? "won" : "lost"} deal can be reopened only by Management.`,
      field: "pipelineStageId",
    });
  }
  if (input.to.isLost) {
    if (!input.lostReasonId) {
      blockers.push({ code: "LOST_REASON_REQUIRED", message: "Choose a lost reason to move this deal to Closed Lost.", field: "lostReasonId" });
    } else if (!input.lostReasonKnown) {
      blockers.push({ code: "LOST_REASON_UNKNOWN", message: "That lost reason does not exist.", field: "lostReasonId" });
    }
  }
  return blockers;
}
