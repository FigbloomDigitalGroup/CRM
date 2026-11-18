import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { dialLinks } from "./quickLogService";

/**
 * Integrations registry and click-to-chat configuration (FIG-1060, B4.03, screen S6).
 *
 * The registry lists every integration with its state: Connected, Not connected, Planned.
 * State comes from real signals wherever one exists: a website key is "connected" once a
 * submission has actually been accepted, the inbound mailbox once mail has actually arrived,
 * not because someone ticked a box. WhatsApp is click-to-chat only, so its state can only
 * come from the configuration (a number on file) and its activity from the WhatsApp calls
 * and messages people log. Management only (`configuration.manage`).
 */
const PERMISSION = "configuration.manage";
export const WHATSAPP_SETTING_KEY = "integrations.whatsapp";

export type IntegrationState = "CONNECTED" | "NOT_CONNECTED" | "PLANNED";

export interface IntegrationEntry {
  key: string;
  name: string;
  description: string;
  state: IntegrationState;
  /** The release that delivers it: V1 now, V1.1 or V2 later. Planned entries are informational. */
  release: "V1" | "V1.1" | "V2" | "LATER";
  /** Why it is in this state, in a sentence a person can act on. */
  stateReason: string;
  lastActivityAt: Date | null;
  lastError: { at: Date | null; message: string } | null;
  connectedBy: string | null;
  /** True when something here can be configured today. */
  configurable: boolean;
}

export const MAX_TEMPLATES = 20;
const MAX_MESSAGE = 1000;
const MAX_LABEL = 60;

export interface WhatsAppTemplate {
  key: string;
  label: string;
  body: string;
}

export interface WhatsAppConfig {
  /** Organisation number as digits with country code, no plus sign (what wa.me wants), or null. */
  number: string | null;
  defaultMessage: string;
  templates: WhatsAppTemplate[];
}

const EMPTY_WHATSAPP: WhatsAppConfig = { number: null, defaultMessage: "", templates: [] };

function readConfig(value: unknown): WhatsAppConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_WHATSAPP };
  const v = value as Partial<WhatsAppConfig>;
  return {
    number: typeof v.number === "string" && v.number ? v.number : null,
    defaultMessage: typeof v.defaultMessage === "string" ? v.defaultMessage : "",
    templates: Array.isArray(v.templates)
      ? v.templates.filter((t): t is WhatsAppTemplate => !!t && typeof t.key === "string" && typeof t.body === "string" && typeof t.label === "string")
      : [],
  };
}

export async function loadWhatsAppConfig(organizationId: string): Promise<WhatsAppConfig> {
  const row = await adminDb.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: WHATSAPP_SETTING_KEY } },
  });
  return readConfig(row?.value);
}

function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface UpdateWhatsAppInput {
  /** A phone number as people write it; null clears it. */
  number?: string | null;
  defaultMessage?: string;
  templates?: { key?: string; label: string; body: string }[];
}

function validateMessage(body: unknown, path: string, issues: ValidationIssue[]): string {
  if (typeof body !== "string") {
    issues.push({ path, message: "Write the message as text." });
    return "";
  }
  const text = body.trim();
  if (text.length > MAX_MESSAGE) issues.push({ path, message: `Keep the message under ${MAX_MESSAGE} characters.` });
  return text;
}

export async function getWhatsAppConfig(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const config = await loadWhatsAppConfig(ctx.organizationId);
  return { ...config, mode: "CLICK_TO_CHAT" as const, mergeFields: ["{{name}}", "{{organisation}}"] };
}

export async function updateWhatsAppConfig(ctx: AuthContext, input: UpdateWhatsAppInput) {
  requirePermission(ctx, PERMISSION);
  const current = await loadWhatsAppConfig(ctx.organizationId);
  const issues: ValidationIssue[] = [];
  const next: WhatsAppConfig = { ...current, templates: [...current.templates] };

  if (input.number !== undefined) {
    if (input.number === null || input.number.trim() === "") {
      next.number = null;
    } else {
      const links = dialLinks(input.number);
      // A wa.me link needs a full international number; dialLinks adds the Kenyan code to a local one.
      if (!links || links.digits.length < 9 || links.digits.length > 15) {
        issues.push({ path: "number", message: "Enter the organisation WhatsApp number, for example +254 700 000 000." });
      } else {
        next.number = links.digits;
      }
    }
  }
  if (input.defaultMessage !== undefined) next.defaultMessage = validateMessage(input.defaultMessage, "defaultMessage", issues);
  if (input.templates !== undefined) {
    if (input.templates.length > MAX_TEMPLATES) issues.push({ path: "templates", message: `Keep it to ${MAX_TEMPLATES} templates or fewer.` });
    const seen = new Set<string>();
    next.templates = [];
    input.templates.forEach((t, i) => {
      const label = typeof t.label === "string" ? t.label.trim() : "";
      if (!label || label.length > MAX_LABEL) issues.push({ path: `templates.${i}.label`, message: `Give the template a name of 1 to ${MAX_LABEL} characters.` });
      const body = validateMessage(t.body, `templates.${i}.body`, issues);
      if (!body) issues.push({ path: `templates.${i}.body`, message: "A template needs some text." });
      const key = (t.key && slug(t.key)) || slug(label) || `template-${i + 1}`;
      if (seen.has(key)) issues.push({ path: `templates.${i}.label`, message: `Two templates would share the key "${key}". Rename one.` });
      seen.add(key);
      next.templates.push({ key, label, body });
    });
  }
  if (issues.length > 0) throw new ValidationError("The WhatsApp settings are not valid.", issues);

  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: WHATSAPP_SETTING_KEY } },
    update: { value: next as never },
    create: { organizationId: ctx.organizationId, key: WHATSAPP_SETTING_KEY, value: next as never },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "integration.whatsapp_updated",
    entityType: "Integration",
    entityId: "WHATSAPP_CLICK_TO_CHAT",
    metadata: { numberSet: next.number !== null, templates: next.templates.length },
  });
  return getWhatsAppConfig(ctx);
}

/** Fills {{name}} and {{organisation}} in a click-to-chat message. Unknown merge fields are left alone. */
export function renderWhatsAppMessage(body: string, vars: { name?: string | null; organisation?: string | null }): string {
  return body
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name?.trim() || "there")
    .replace(/\{\{\s*organisation\s*\}\}/gi, vars.organisation?.trim() || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The wa.me link for a person's number with the chosen (or default) message filled in. Null when there is no number to open. */
export async function whatsappLinkFor(
  organizationId: string,
  phone: string | null | undefined,
  options: { templateKey?: string; name?: string | null } = {},
): Promise<{ href: string; message: string } | null> {
  const links = dialLinks(phone);
  if (!links) return null;
  const [config, org] = await Promise.all([
    loadWhatsAppConfig(organizationId),
    adminDb.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);
  const template = options.templateKey ? config.templates.find((t) => t.key === options.templateKey) : undefined;
  const raw = template?.body ?? config.defaultMessage;
  const message = renderWhatsAppMessage(raw, { name: options.name, organisation: org?.name });
  return { href: message ? `${links.whatsapp}?text=${encodeURIComponent(message)}` : links.whatsapp, message };
}

export async function listIntegrations(ctx: AuthContext): Promise<{ integrations: IntegrationEntry[]; counts: Record<IntegrationState, number> }> {
  requirePermission(ctx, PERMISSION);
  const organizationId = ctx.organizationId;
  const [website, inbound, whatsapp, lastWhatsAppLog] = await Promise.all([
    adminDb.websiteApiKey.findUnique({ where: { organizationId }, include: { createdBy: { select: { user: { select: { name: true } } } } } }),
    adminDb.inboundEmailKey.findUnique({ where: { organizationId }, include: { createdBy: { select: { user: { select: { name: true } } } } } }),
    loadWhatsAppConfig(organizationId),
    adminDb.communication.findFirst({
      where: { organizationId, channel: "WHATSAPP" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
  ]);

  const entries: IntegrationEntry[] = [];

  // Website lead form: connected once a submission was actually accepted.
  {
    let state: IntegrationState = "NOT_CONNECTED";
    let stateReason = "No website key has been created yet.";
    let lastError: IntegrationEntry["lastError"] = null;
    if (website) {
      if (website.revokedAt) {
        stateReason = "The website key was revoked, so the form is switched off.";
      } else if (website.lastAcceptedAt) {
        state = "CONNECTED";
        stateReason = "The website has sent leads through.";
      } else {
        stateReason = "A key exists but no submission has been accepted yet.";
      }
      if (website.lastRejectedAt && (!website.lastAcceptedAt || website.lastRejectedAt > website.lastAcceptedAt)) {
        lastError = { at: website.lastRejectedAt, message: "The most recent submission was turned away. See rejected submissions." };
      }
    }
    entries.push({
      key: "WEBSITE",
      name: "Website lead form",
      description: "Leads from the website enquiry form arrive here with a key and abuse protection.",
      state,
      release: "V1",
      stateReason,
      lastActivityAt: website?.lastAcceptedAt ?? website?.lastUsedAt ?? null,
      lastError,
      connectedBy: website?.createdBy?.user.name ?? null,
      configurable: true,
    });
  }

  // Inbound email (BCC to the CRM): connected once mail has actually arrived.
  {
    let state: IntegrationState = "NOT_CONNECTED";
    let stateReason = "No inbound email token has been created yet.";
    if (inbound) {
      if (inbound.revokedAt) stateReason = "The inbound email token was revoked.";
      else if (inbound.lastUsedAt) {
        state = "CONNECTED";
        stateReason = "Mail has been received.";
      } else stateReason = "A token exists but no mail has arrived yet.";
    }
    entries.push({
      key: "INBOUND_EMAIL",
      name: "Inbound email (BCC to the CRM)",
      description: "Copy the CRM on an email and it is logged against the contact, or waits in Needs linking.",
      state,
      release: "V1",
      stateReason,
      lastActivityAt: inbound?.lastUsedAt ?? null,
      lastError: inbound?.lastError ? { at: inbound.lastErrorAt, message: inbound.lastError } : null,
      connectedBy: inbound?.createdBy?.user.name ?? null,
      configurable: true,
    });
  }

  // WhatsApp: click-to-chat only. Connected means a number is on file; activity is the WhatsApp calls people logged.
  entries.push({
    key: "WHATSAPP_CLICK_TO_CHAT",
    name: "WhatsApp (click to chat)",
    description: "Opens WhatsApp with a message ready to send. The WhatsApp Business API is not part of V1.",
    state: whatsapp.number ? "CONNECTED" : "NOT_CONNECTED",
    release: "V1",
    stateReason: whatsapp.number ? "An organisation number is set." : "Set the organisation WhatsApp number to switch it on.",
    lastActivityAt: lastWhatsAppLog?.occurredAt ?? null,
    lastError: null,
    connectedBy: null,
    configurable: true,
  });

  const planned = (key: string, name: string, description: string, release: IntegrationEntry["release"]) =>
    entries.push({
      key,
      name,
      description,
      state: "PLANNED",
      release,
      stateReason: release === "LATER" ? "Planned for a later release." : `Arrives with ${release}.`,
      lastActivityAt: null,
      lastError: null,
      connectedBy: null,
      configurable: false,
    });
  planned("EMAIL_PROVIDER", "Email provider", "Send and receive email from the CRM through the company mailbox.", "V1.1");
  planned("CALENDAR", "Calendar", "Two-way sync with the company calendar.", "V1.1");
  planned("API_WEBHOOKS", "API and webhooks", "A public API and outgoing webhooks for other systems.", "V2");
  planned("ACCOUNTING", "Accounting", "Match invoices and payments to the accounting system.", "LATER");

  const counts: Record<IntegrationState, number> = { CONNECTED: 0, NOT_CONNECTED: 0, PLANNED: 0 };
  for (const e of entries) counts[e.state] += 1;
  return { integrations: entries, counts };
}
