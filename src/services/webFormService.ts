import { openSecret, sealSecret } from "../lib/secretBox";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { cleanFields, cleanOrigins, DEFAULT_FIELDS, generatePublicKey, type FormField } from "../lib/webForms";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createFormRow,
  deleteFormRow,
  findFormByName,
  getFormRow,
  leadSourceExists,
  listFormRows,
  listSubmissionRows,
  submissionCounts,
  updateFormRow,
} from "../repositories/webForms";
import { requireFeature } from "./featureService";

/**
 * The web forms builder (FIG-1151, B6.19, design S6#2). Management (`configuration.manage`, the same bucket as the website key)
 * defines forms in Settings; the public endpoint that receives submissions is `webFormSubmissionService.ts`. See docs/WEB_FORMS.md.
 * V1.1: needs the organisation to be on release V1.1.
 */

const PERMISSION = "configuration.manage";
const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
type Status = (typeof STATUSES)[number];
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;
const MAX_FORMS = 50;

type Row = NonNullable<Awaited<ReturnType<typeof getFormRow>>>;

/** The captcha secret is stored encrypted like OAuth tokens (src/lib/secretBox.ts). */
function sealCaptchaSecret(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? sealSecret(value.trim()) : null;
}

/** The plain secret for verifying a token. A value saved before sealing existed is not in the sealed format and is returned as stored. */
export function readCaptchaSecret(stored: string): string {
  return /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(stored) ? openSecret(stored) : stored;
}

/** A form as the builder sees it. The captcha secret is write-only: only whether one is set is ever returned. */
function present(row: Row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status as Status,
    publicKey: row.publicKey,
    fields: row.fields as unknown as FormField[],
    leadSourceKey: row.leadSourceKey,
    successMessage: row.successMessage,
    allowedOrigins: row.allowedOrigins,
    honeypotFieldName: row.honeypotFieldName,
    captchaConfigured: row.captchaSecret !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > 80) throw new ValidationError("A name of 1 to 80 characters is required.", [{ path: "name", message: "1 to 80 characters." }]);
  return n;
}

function cleanHoneypot(value: unknown): string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new ValidationError("The hidden trap field is a lower case name such as website_url.", [{ path: "honeypotFieldName", message: "Lower case letters, digits and underscores." }]);
  }
  return value;
}

function cleanMessage(value: unknown): string {
  const m = typeof value === "string" ? value.trim() : "";
  if (!m || m.length > 300) throw new ValidationError("A success message of 1 to 300 characters is required.", [{ path: "successMessage", message: "1 to 300 characters." }]);
  return m;
}

function throwProblems(problems: { path: string; message: string }[]) {
  if (problems.length > 0) throw new ValidationError("This form is not valid.", problems);
}

async function checkSource(ctx: AuthContext, key: unknown): Promise<string | null> {
  if (key === null || key === undefined || key === "") return null;
  if (typeof key !== "string" || !(await leadSourceExists(ctx.organizationId, key))) {
    throw new ValidationError("That lead source does not exist or is switched off.", [{ path: "leadSourceKey", message: "Pick an active lead source." }]);
  }
  return key;
}

async function load(ctx: AuthContext, id: string): Promise<Row> {
  const row = await getFormRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("WebForm", id);
  return row;
}

async function gate(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  await requireFeature(ctx.organizationId, "release.v11");
}

export async function listForms(ctx: AuthContext) {
  await gate(ctx);
  return { items: (await listFormRows(ctx.organizationId)).map(present) };
}

export async function getForm(ctx: AuthContext, id: string) {
  await gate(ctx);
  const row = await load(ctx, id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { ...present(row), last30Days: await submissionCounts(ctx.organizationId, id, since) };
}

export async function createForm(
  ctx: AuthContext,
  input: { name: string; fields?: unknown; leadSourceKey?: string | null; successMessage?: string; allowedOrigins?: unknown; honeypotFieldName?: string; captchaSecret?: string | null },
) {
  await gate(ctx);
  const name = cleanName(input.name);
  if (await findFormByName(ctx.organizationId, name)) throw new ValidationError("A form with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_FORM" }]);
  if ((await listFormRows(ctx.organizationId)).length >= MAX_FORMS) throw new ValidationError(`An organisation can have at most ${MAX_FORMS} forms.`, [{ path: "name", message: "Archive or delete a form first." }]);
  const honeypot = input.honeypotFieldName === undefined ? "website_url" : cleanHoneypot(input.honeypotFieldName);
  const { fields, problems } = cleanFields(input.fields ?? DEFAULT_FIELDS, honeypot);
  const origins = input.allowedOrigins === undefined ? { origins: [], problems: [] } : cleanOrigins(input.allowedOrigins);
  throwProblems([...problems, ...origins.problems]);
  const row = await createFormRow({
    organizationId: ctx.organizationId,
    name,
    publicKey: generatePublicKey(),
    status: "DRAFT",
    fields: fields as unknown as object,
    leadSourceKey: await checkSource(ctx, input.leadSourceKey),
    ...(input.successMessage !== undefined ? { successMessage: cleanMessage(input.successMessage) } : {}),
    allowedOrigins: origins.origins,
    honeypotFieldName: honeypot,
    captchaSecret: sealCaptchaSecret(input.captchaSecret),
    createdByMembershipId: ctx.membershipId,
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "web_form.created", entityType: "WebForm", entityId: row.id, newValue: { name } });
  return present(row);
}

export async function updateForm(
  ctx: AuthContext,
  id: string,
  patch: { name?: string; status?: string; fields?: unknown; leadSourceKey?: string | null; successMessage?: string; allowedOrigins?: unknown; honeypotFieldName?: string; captchaSecret?: string | null },
) {
  await gate(ctx);
  const row = await load(ctx, id);
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    const clash = await findFormByName(ctx.organizationId, name);
    if (clash && clash.id !== id) throw new ValidationError("A form with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_FORM" }]);
    data.name = name;
  }
  const honeypot = patch.honeypotFieldName !== undefined ? cleanHoneypot(patch.honeypotFieldName) : row.honeypotFieldName;
  if (patch.honeypotFieldName !== undefined) data.honeypotFieldName = honeypot;
  const problems: { path: string; message: string }[] = [];
  // The fields are always re-checked against the honeypot name and the publishing rule, so a rename cannot leave a clash.
  const checked = cleanFields(patch.fields ?? row.fields, honeypot);
  if (patch.fields !== undefined || patch.honeypotFieldName !== undefined || patch.status === "PUBLISHED") problems.push(...checked.problems);
  if (patch.fields !== undefined) data.fields = checked.fields as unknown as object;
  if (patch.allowedOrigins !== undefined) {
    const o = cleanOrigins(patch.allowedOrigins);
    problems.push(...o.problems);
    data.allowedOrigins = o.origins;
  }
  throwProblems(problems);
  if (patch.leadSourceKey !== undefined) data.leadSourceKey = await checkSource(ctx, patch.leadSourceKey);
  if (patch.successMessage !== undefined) data.successMessage = cleanMessage(patch.successMessage);
  if (patch.captchaSecret !== undefined) data.captchaSecret = sealCaptchaSecret(patch.captchaSecret);
  if (patch.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(patch.status)) throw new ValidationError("status is DRAFT, PUBLISHED or ARCHIVED.", [{ path: "status", message: "DRAFT, PUBLISHED or ARCHIVED." }]);
    data.status = patch.status;
  }
  const updated = await updateFormRow(ctx.organizationId, id, data);
  const action = patch.status && patch.status !== row.status ? `web_form.${patch.status.toLowerCase()}` : "web_form.updated";
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action,
    entityType: "WebForm",
    entityId: id,
    previousValue: { name: row.name, status: row.status },
    newValue: { name: updated.name, status: updated.status, captchaChanged: patch.captchaSecret !== undefined },
  });
  return present(updated);
}

/** A new public key; the old one stops working at once (the form must be re-embedded). */
export async function rotateFormKey(ctx: AuthContext, id: string) {
  await gate(ctx);
  const row = await load(ctx, id);
  const updated = await updateFormRow(ctx.organizationId, id, { publicKey: generatePublicKey() });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "web_form.key_rotated", entityType: "WebForm", entityId: id, previousValue: { name: row.name } });
  return present(updated);
}

export async function deleteForm(ctx: AuthContext, id: string) {
  await gate(ctx);
  const row = await load(ctx, id);
  await deleteFormRow(ctx.organizationId, id);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "web_form.deleted", entityType: "WebForm", entityId: id, previousValue: { name: row.name } });
  return { id };
}

export const SUBMISSION_EXPLANATIONS: Record<string, string> = {
  ACCEPTED: "A lead was created.",
  RATE_LIMITED: "Too many submissions from one address or to this form in a short time.",
  INVALID_KEY: "The form key was wrong.",
  ORIGIN_NOT_ALLOWED: "The submission came from a website that is not on the form's allowed list.",
  PAYLOAD_TOO_LARGE: "The submission was larger than the limit.",
  VALIDATION_FAILED: "The submission was missing a required answer or an answer was not valid.",
  HONEYPOT_TRIGGERED: "A hidden field was filled in, which is what a bot does. It was discarded.",
  CAPTCHA_FAILED: "The captcha check failed or was missing.",
  SPAM_CONTENT: "The submission held too many links to be a real enquiry.",
};

/** The log of attempts on one form, newest first; `accepted=false` is the rejected-submission log. */
export async function listFormSubmissions(ctx: AuthContext, id: string, query: { accepted?: boolean; outcome?: string; paging?: PageRequest } = {}) {
  await gate(ctx);
  await load(ctx, id);
  if (query.outcome !== undefined && !(query.outcome in SUBMISSION_EXPLANATIONS)) {
    throw new ValidationError(`"${query.outcome}" is not an outcome.`, [{ path: "outcome", message: `Use one of: ${Object.keys(SUBMISSION_EXPLANATIONS).join(", ")}.` }]);
  }
  const paging = resolvePaging(query.paging);
  const { rows, total } = await listSubmissionRows(ctx.organizationId, id, { outcome: query.outcome, accepted: query.accepted, skip: paging.skip, take: paging.take });
  return buildPage(
    rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      outcome: r.outcome,
      explanation: SUBMISSION_EXPLANATIONS[r.outcome] ?? null,
      reason: r.reason,
      origin: r.origin,
      ipAddress: r.ipAddress,
      leadId: r.leadId,
      duplicateWarning: r.duplicateContact || r.duplicateCompany ? { contact: r.duplicateContact, company: r.duplicateCompany } : null,
    })),
    total,
    paging,
  );
}
