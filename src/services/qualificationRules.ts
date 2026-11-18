import type { CustomFieldDefinition, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { ValidationError, type ValidationIssue } from "../auth/errors";
import { applyValues, missingRequired, type FieldDefinition } from "../lib/customFields";
import { recordAuditEvent } from "../repositories/auditEvents";
import { loadActiveDefinitions, toFieldDefinition } from "./customFieldService";

/**
 * The rules of lead qualification (FIG-1030, B2.01), kept apart from the lead
 * service so the lead service can use them without importing the other way.
 */

/** The stages of the progress strip, in order. Other statuses (Unqualified, Lost, Inactive) are off the strip. */
export const STRIP_STATUS_KEYS = ["NEW", "CONTACTED", "NEEDS_IDENTIFIED", "QUALIFIED", "CONVERTED"] as const;
export const OFF_STRIP_KEYS = ["UNQUALIFIED", "LOST", "INACTIVE"] as const;

export type AnswerMap = Record<string, unknown>;
export function asAnswers(value: Prisma.JsonValue | null | undefined): AnswerMap {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as AnswerMap) } : {};
}

/** A question applies when it is for every service, or for the lead's own service. */
export function questionApplies(def: Pick<FieldDefinition, "serviceId">, serviceInterestId: string | null): boolean {
  return def.serviceId === null || def.serviceId === serviceInterestId;
}

export async function loadQuestions(organizationId: string) {
  return loadActiveDefinitions(organizationId, "LEAD", "QUALIFICATION");
}

/** Missing required-on-qualify answers for a lead with this service and these answers. */
export function missingForQualify(
  questions: CustomFieldDefinition[],
  serviceInterestId: string | null,
  answers: AnswerMap,
): ValidationIssue[] {
  const applicable = questions.filter((q) => questionApplies(q, serviceInterestId)).map(toFieldDefinition);
  return missingRequired(applicable, answers, "qualify", "qualificationData");
}

export async function recordQualificationChange(
  ctx: AuthContext,
  leadId: string,
  changes: Record<string, { before: unknown; after: unknown }>,
) {
  const keys = Object.keys(changes);
  if (keys.length === 0) return;
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead.qualification_updated",
    entityType: "Lead",
    entityId: leadId,
    previousValue: Object.fromEntries(keys.map((k) => [k, changes[k]!.before])) as Prisma.InputJsonValue,
    newValue: Object.fromEntries(keys.map((k) => [k, changes[k]!.after])) as Prisma.InputJsonValue,
  });
}

/**
 * For `updateLead` and `createLead`: validates qualification answers sent with
 * a lead (keys that are not questions pass through untouched, because the
 * website form and imports store their own keys there) and, when the lead is
 * moving to Qualified, requires the answers its service needs.
 */
export async function checkQualificationForSave(input: {
  organizationId: string;
  serviceInterestId: string | null;
  existing: Prisma.JsonValue | null | undefined;
  incoming: unknown;
  becomingQualified: boolean;
}): Promise<{ values: Prisma.InputJsonValue | undefined; changes: Record<string, { before: unknown; after: unknown }> }> {
  const questions = await loadQuestions(input.organizationId);
  const existing = asAnswers(input.existing);
  let values: AnswerMap = existing;
  let changes: Record<string, { before: unknown; after: unknown }> = {};
  const issues: ValidationIssue[] = [];

  if (input.incoming !== undefined && input.incoming !== null) {
    if (typeof input.incoming !== "object" || Array.isArray(input.incoming)) {
      throw new ValidationError("Qualification answers must be an object.", [{ path: "qualificationData", message: "Send an object of answers." }]);
    }
    // Sent as a whole object: the answers to known questions are validated, and the rest is kept as sent.
    const result = applyValues(
      questions.map(toFieldDefinition),
      input.incoming as AnswerMap,
      { existing, unknownKeys: "keep", applies: (d) => questionApplies(d, input.serviceInterestId) },
      "qualificationData",
    );
    issues.push(...result.issues);
    values = result.values;
    changes = result.changes;
  }
  if (input.becomingQualified) {
    issues.push(...missingForQualify(questions, input.serviceInterestId, values));
  }
  if (issues.length > 0) {
    throw new ValidationError("This lead cannot be saved as it is.", issues);
  }
  return { values: input.incoming === undefined || input.incoming === null ? undefined : (values as Prisma.InputJsonValue), changes };
}
