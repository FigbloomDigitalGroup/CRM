import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requireOwnedRecordPermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { assertWritable } from "../lib/archive";
import { applyValues, optionsOf } from "../lib/customFields";
import { updateLead as updateLeadRecord } from "../repositories/leads";
import { toFieldDefinition } from "./customFieldService";
import { getLead } from "./leadService";
import { rescoreLeadQuietly } from "./scoreEngine";
import {
  OFF_STRIP_KEYS,
  STRIP_STATUS_KEYS,
  asAnswers,
  loadQuestions,
  missingForQualify,
  questionApplies,
  recordQualificationChange,
} from "./qualificationRules";

/**
 * Lead qualification (FIG-1030, B2.01): the questions that apply to a lead's
 * service, its answers, and the progress strip state the lead page draws.
 * Questions are `custom_field_definitions` with section QUALIFICATION; answers
 * live in the lead's `qualificationData`. Required-on-qualify answers block the
 * move to Qualified with a field-level error list.
 */

export interface QualificationView {
  leadId: string;
  serviceInterestId: string | null;
  questions: {
    key: string;
    label: string;
    fieldType: string;
    options: { value: string; label: string }[];
    helpText: string | null;
    required: boolean;
    requiredOnQualify: boolean;
    /** Null means the question is asked of every service. */
    serviceId: string | null;
    answer: unknown;
    answered: boolean;
  }[];
  /** Stored answers to questions that do not apply now (the service changed). They are kept, not shown as questions. */
  keptAnswers: { key: string; label: string | null; answer: unknown }[];
  progress: {
    stages: { key: string; name: string; state: "done" | "current" | "todo" }[];
    /** Set when the lead is Unqualified, Lost or Inactive: it is off the strip. */
    offStrip: { key: string; name: string } | null;
    /** Required-on-qualify answers still missing, with the message to show. */
    missing: { key: string; label: string; message: string }[];
    canQualify: boolean;
    qualified: boolean;
  };
}

export async function getQualification(ctx: AuthContext, leadId: string): Promise<QualificationView> {
  const lead = await getLead(ctx, leadId);
  const [questions, statuses] = await Promise.all([
    loadQuestions(ctx.organizationId),
    adminDb.leadStatus.findMany({ where: { organizationId: ctx.organizationId }, select: { key: true, name: true } }),
  ]);
  const answers = asAnswers(lead.qualificationData);
  const applicable = questions.filter((q) => questionApplies(q, lead.serviceInterestId));
  const applicableKeys = new Set(applicable.map((q) => q.key));
  const nameOf = new Map(statuses.map((s) => [s.key, s.name]));

  const statusKey = lead.leadStatus.key;
  const stripIndex = lead.convertedAt ? STRIP_STATUS_KEYS.length : STRIP_STATUS_KEYS.indexOf(statusKey as (typeof STRIP_STATUS_KEYS)[number]);
  const offStrip = (OFF_STRIP_KEYS as readonly string[]).includes(statusKey)
    ? { key: statusKey, name: nameOf.get(statusKey) ?? statusKey }
    : null;
  const stages = STRIP_STATUS_KEYS.map((key, i) => ({
    key,
    name: nameOf.get(key) ?? key,
    state: (offStrip || stripIndex < 0 ? "todo" : i < stripIndex ? "done" : i === stripIndex ? "current" : "todo") as "done" | "current" | "todo",
  }));

  const missing = missingForQualify(questions, lead.serviceInterestId, answers).map((issue) => {
    const key = issue.path.split(".").pop()!;
    const q = questions.find((x) => x.key === key)!;
    return { key, label: q.label, message: issue.message };
  });
  const labelOf = new Map(questions.map((q) => [q.key, q.label]));

  return {
    leadId,
    serviceInterestId: lead.serviceInterestId,
    questions: applicable.map((q) => {
      const answer = answers[q.key] ?? null;
      return {
        key: q.key,
        label: q.label,
        fieldType: q.fieldType,
        options: optionsOf({ options: q.options }),
        helpText: q.helpText,
        required: q.required,
        requiredOnQualify: q.requiredOnQualify,
        serviceId: q.serviceId,
        answer,
        answered: !(answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0)),
      };
    }),
    keptAnswers: Object.entries(answers)
      .filter(([key]) => !applicableKeys.has(key) && labelOf.has(key))
      .map(([key, answer]) => ({ key, label: labelOf.get(key) ?? null, answer })),
    progress: {
      stages,
      offStrip,
      missing,
      canQualify: missing.length === 0,
      qualified: lead.convertedAt !== null || statusKey === "QUALIFIED",
    },
  };
}

/**
 * Saves answers (merged into the stored ones; null clears one). Only keys that
 * are questions of this organisation are accepted, and only those that apply to
 * the lead's service. Answers to questions that no longer apply stay as they
 * were.
 */
export async function updateQualification(ctx: AuthContext, leadId: string, answers: Record<string, unknown>) {
  const lead = await getLead(ctx, leadId);
  requireOwnedRecordPermission(ctx, "leads.edit.own", "leads.edit.all", lead.ownerMembershipId);
  assertWritable(ctx, "lead", lead, "changing its answers");

  const questions = await loadQuestions(ctx.organizationId);
  const result = applyValues(
    questions.map(toFieldDefinition),
    answers,
    {
      existing: asAnswers(lead.qualificationData),
      unknownKeys: "reject",
      applies: (def) => questionApplies(def, lead.serviceInterestId),
    },
    "qualificationData",
  );
  if (result.issues.length > 0) throw new ValidationError("Some answers are not valid.", result.issues);

  if (Object.keys(result.changes).length > 0) {
    await updateLeadRecord(ctx.organizationId, leadId, { qualificationData: result.values as Prisma.InputJsonValue });
    await recordQualificationChange(ctx, leadId, result.changes);
    await rescoreLeadQuietly(ctx.organizationId, leadId);
  }
  return getQualification(ctx, leadId);
}

