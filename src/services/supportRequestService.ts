import { randomBytes } from "crypto";
import { ROLES } from "../../prisma/seedData";
import type { AuthContext } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { enforceRateLimit } from "../auth/rateLimiter";
import { adminDb } from "../db/adminClient";
import { resendApiKey, sendWithResend, ResendError, type SendOptions } from "../integrations/email/resend";
import { ApiError } from "../lib/apiErrors";
import { logger } from "../lib/logger";
import { recordAuditEvent } from "../repositories/auditEvents";

/**
 * Support requests by email (docs/SUPPORT_BY_EMAIL.md, decision 12 of 5 Nov 2026).
 *
 * There is no Customer Support role and no ticket table in the CRM. A member who needs help sends a request from the app; it
 * goes out through Resend to Figbloom's support inbox, where the platform console turns it into a ticket. The member's own
 * address is the Reply-To, so the answer reaches them by email and never needs a second sign-in.
 *
 * Any active member of any role may ask for help (the same as opening Help). The email carries who asked, from which
 * organisation, in which role and from which page. It carries no deal value, cost, margin or payment (hard rule 7): the only
 * free text in it is what the member typed.
 */
export const SUPPORT_CATEGORIES = ["QUESTION", "PROBLEM", "ACCESS", "BILLING", "OTHER"] as const;
export const SUPPORT_URGENCIES = ["NORMAL", "URGENT"] as const;
export const MAX_SUBJECT = 160;
export const MAX_MESSAGE = 5000;
export const MAX_PAGE_PATH = 300;
/** A member sends at most this many requests an hour, an organisation at most this many (they share one inbox). */
export const MEMBER_HOURLY_LIMIT = 5;
export const ORGANISATION_HOURLY_LIMIT = 20;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportUrgency = (typeof SUPPORT_URGENCIES)[number];

export interface SupportRequestInput {
  subject: string;
  message: string;
  category?: string;
  urgency?: string;
  /** The page the member was on, as a path ("/o/acme/deals/123"): helps support find the problem. */
  pagePath?: string | null;
}

export interface SupportRequestResult {
  /** Quoted in the subject of the email, so the member and support can find each other's messages. */
  reference: string;
  /** False when no email provider is configured in a non-production environment: the request was logged, not sent. */
  sent: boolean;
}

export interface SupportEmailConfig {
  from: string;
  inbox: string;
}

/** `SUPPORT_EMAIL_FROM` (a verified Resend sender) and `SUPPORT_INBOX_EMAIL` (where Figbloom reads requests). Both are needed with the API key. */
export function readSupportEmailConfig(): SupportEmailConfig | null {
  const from = process.env.SUPPORT_EMAIL_FROM?.trim();
  const inbox = process.env.SUPPORT_INBOX_EMAIL?.trim();
  if (!from || !inbox) return null;
  return { from, inbox };
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
// Crockford-style: no 0/O, 1/I/L, so a reference read aloud over the phone is not misheard.
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newSupportReference(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const bytes = randomBytes(6);
  let tail = "";
  for (const b of bytes) tail += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length];
  return `FB-${day}-${tail}`;
}

/** One line, no control characters: safe in a subject or a header. */
function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function body(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], field: string, fallback: T): T {
  if (value === undefined || value === "") return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(", ")}.`, [{ path: field, message: `Choose one of ${allowed.join(", ")}.` }]);
  }
  return value as T;
}

export function validateSupportRequest(input: SupportRequestInput) {
  const subject = oneLine(input.subject ?? "");
  const message = body(input.message ?? "");
  const issues: { path: string; message: string }[] = [];
  if (!subject) issues.push({ path: "subject", message: "Say in a few words what you need help with." });
  else if (subject.length > MAX_SUBJECT) issues.push({ path: "subject", message: `At most ${MAX_SUBJECT} characters.` });
  if (!message) issues.push({ path: "message", message: "Tell us what happened or what you need." });
  else if (message.length > MAX_MESSAGE) issues.push({ path: "message", message: `At most ${MAX_MESSAGE} characters.` });

  let pagePath: string | null = null;
  const rawPath = oneLine(input.pagePath ?? "");
  if (rawPath) {
    // Only a path inside the app: never a full URL, a query string or a fragment (they can carry tokens).
    if (!rawPath.startsWith("/") || rawPath.startsWith("//")) issues.push({ path: "pagePath", message: "Send a path that starts with a single /." });
    else pagePath = rawPath.split(/[?#]/)[0]!.slice(0, MAX_PAGE_PATH);
  }
  if (issues.length) throw new ValidationError("Check the highlighted fields.", issues);

  return {
    subject,
    message,
    pagePath,
    category: oneOf(input.category, SUPPORT_CATEGORIES, "category", "QUESTION"),
    urgency: oneOf(input.urgency, SUPPORT_URGENCIES, "urgency", "NORMAL"),
  };
}

const CATEGORY_LABEL: Record<SupportCategory, string> = {
  QUESTION: "Question",
  PROBLEM: "Something is not working",
  ACCESS: "Sign-in or access",
  BILLING: "Billing or plan",
  OTHER: "Other",
};

export interface ComposedSupportEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  replyTo: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
}

export function composeSupportEmail(args: {
  config: SupportEmailConfig;
  reference: string;
  request: ReturnType<typeof validateSupportRequest>;
  member: { name: string; email: string; roleName: string };
  organization: { id: string; name: string; slug: string };
  at: Date;
}): ComposedSupportEmail {
  const { config, reference, request, member, organization } = args;
  const urgent = request.urgency === "URGENT";
  const text = [
    request.message,
    "",
    "----------------------------------------",
    `Reference:     ${reference}`,
    `Category:      ${CATEGORY_LABEL[request.category]}`,
    `Urgency:       ${urgent ? "URGENT" : "Normal"}`,
    `From:          ${oneLine(member.name)} <${member.email}> (${member.roleName})`,
    `Organisation:  ${oneLine(organization.name)} (${organization.slug})`,
    `Organisation id: ${organization.id}`,
    ...(request.pagePath ? [`Page:          ${request.pagePath}`] : []),
    `Sent:          ${args.at.toISOString()}`,
    "",
    "Reply to this email to answer the member directly.",
  ].join("\n");

  return {
    from: config.from,
    to: [config.inbox],
    subject: `${urgent ? "[URGENT] " : ""}[${reference}] ${request.subject}`,
    text,
    replyTo: member.email,
    headers: {
      "X-Figbloom-Support-Reference": reference,
      "X-Figbloom-Organization-Id": organization.id,
      "X-Figbloom-Organization-Slug": organization.slug,
    },
    tags: [
      { name: "kind", value: "support_request" },
      { name: "category", value: request.category.toLowerCase() },
    ],
  };
}

export interface SupportRequestDeps {
  now?: Date;
  send?: SendOptions;
}

export async function createSupportRequest(ctx: AuthContext, input: SupportRequestInput, deps: SupportRequestDeps = {}): Promise<SupportRequestResult> {
  const request = validateSupportRequest(input);

  const config = readSupportEmailConfig();
  const configured = Boolean(config) && Boolean(deps.send?.apiKey ?? resendApiKey());
  if (!configured && process.env.NODE_ENV === "production") {
    // Better an honest "not set up" than a request that disappears.
    logger.error("Support request refused: RESEND_API_KEY, SUPPORT_EMAIL_FROM or SUPPORT_INBOX_EMAIL is not set in production.");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Support by email is not set up yet. Please ask your Figbloom contact how to reach support.");
  }

  const [user, organization] = await Promise.all([
    adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, email: true } }),
    adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { id: true, name: true, slug: true } }),
  ]);
  if (!EMAIL.test(user.email)) {
    throw new ValidationError("Your account has no usable email address to send your request from.");
  }

  await enforceRateLimit("SUPPORT_REQUEST", [
    { scope: "membership", key: ctx.membershipId, windowMs: 60 * 60_000, max: MEMBER_HOURLY_LIMIT },
    { scope: "organization", key: ctx.organizationId, windowMs: 60 * 60_000, max: ORGANISATION_HOURLY_LIMIT },
  ]);

  const now = deps.now ?? new Date();
  const reference = newSupportReference(now);
  const roleName = ROLES.find((r) => r.key === ctx.roleKey)?.name ?? ctx.roleKey;

  if (!configured) {
    // Local development without an API key: same as the SMTP fallback, log and say so.
    logger.info({ reference, organizationId: ctx.organizationId, category: request.category }, "Support request not sent: RESEND_API_KEY, SUPPORT_EMAIL_FROM or SUPPORT_INBOX_EMAIL is not set.");
    return { reference, sent: false };
  }

  const email = composeSupportEmail({
    config: config!,
    reference,
    request,
    member: { name: user.name, email: user.email, roleName },
    organization,
    at: now,
  });

  let resendId: string | null = null;
  try {
    const sent = await sendWithResend(email, { ...deps.send, idempotencyKey: deps.send?.idempotencyKey ?? `support-${reference}` });
    resendId = sent.id;
  } catch (err) {
    const detail = err instanceof ResendError ? { status: err.status, resendName: err.resendName } : {};
    logger.error({ reference, organizationId: ctx.organizationId, ...detail }, "Support request email failed");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "We could not send your request just now. Please try again in a few minutes.");
  }

  try {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      actorUserId: ctx.userId,
      action: "support.request_sent",
      entityType: "SupportRequest",
      entityId: reference,
      // Never the message or the subject: they are the member's words, held in the support inbox, not in our audit trail.
      metadata: { reference, category: request.category, urgency: request.urgency, resendId },
    });
  } catch (err) {
    // The email is out; failing the request now would make the member send it twice.
    logger.error({ err, reference }, "Support request sent but its audit event failed");
  }

  return { reference, sent: true };
}
