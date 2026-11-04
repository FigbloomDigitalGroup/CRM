import { randomBytes } from "node:crypto";

/**
 * Web forms, the pure rules (FIG-1151, B6.19): what a form definition may hold, and how a public submission is checked against
 * it. Nothing here touches the database. `src/services/webFormService.ts` (builder) and `webFormSubmissionService.ts` (public
 * endpoint) use it. Rules are written out in docs/WEB_FORMS.md.
 */

export const FIELD_TYPES = ["text", "email", "phone", "textarea", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** The lead field a form field fills; a field with no mapping is kept in the lead's notes. */
export const FIELD_MAPS = ["name", "email", "phone", "company", "service", "message"] as const;
export type FieldMap = (typeof FIELD_MAPS)[number];

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  maps: FieldMap | null;
  options?: string[];
}

export const MAX_FIELDS = 15;
export const MAX_OPTIONS = 20;
export const MAX_ORIGINS = 10;
export const MAX_PAYLOAD_BYTES = 10_000;
/** More links than this in a submission is treated as spam. */
export const MAX_LINKS = 2;
const MAX_KEYS_IN_BODY = 40;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;
export const RESERVED_KEYS = ["captchaToken"];

export const DEFAULT_FIELDS: FormField[] = [
  { key: "name", label: "Full name", type: "text", required: true, maps: "name" },
  { key: "email", label: "Email", type: "email", required: true, maps: "email" },
  { key: "phone", label: "Phone", type: "phone", required: false, maps: "phone" },
  { key: "message", label: "Message", type: "textarea", required: false, maps: "message" },
];

const LIMITS: Record<FieldType, number> = { text: 500, email: 320, phone: 32, textarea: 5000, select: 100 };
/** A mapped name and company are looser than a free text answer, as on the website endpoint. */
const MAP_LIMITS: Partial<Record<FieldMap, number>> = { name: 200, company: 200, service: 100 };

export function generatePublicKey(): string {
  return `wfk_${randomBytes(18).toString("base64url")}`;
}

export interface DefinitionProblem {
  path: string;
  message: string;
}

/** Checks and cleans a form's fields. Returns the cleaned fields and every problem found. */
export function cleanFields(input: unknown, honeypotFieldName: string): { fields: FormField[]; problems: DefinitionProblem[] } {
  const problems: DefinitionProblem[] = [];
  const fields: FormField[] = [];
  if (!Array.isArray(input)) return { fields, problems: [{ path: "fields", message: "fields is a list." }] };
  if (input.length === 0 || input.length > MAX_FIELDS) problems.push({ path: "fields", message: `A form has 1 to ${MAX_FIELDS} fields.` });
  const seen = new Set<string>();
  const maps = new Set<string>();
  input.slice(0, MAX_FIELDS + 1).forEach((raw, i) => {
    const at = `fields.${i}`;
    const f = (raw ?? {}) as Record<string, unknown>;
    const key = typeof f.key === "string" ? f.key : "";
    const label = typeof f.label === "string" ? f.label.trim().replace(/\s+/g, " ") : "";
    if (!KEY_PATTERN.test(key)) problems.push({ path: `${at}.key`, message: "A field key is lower case letters, digits and underscores, starting with a letter (30 at most)." });
    else if (RESERVED_KEYS.includes(key) || key === honeypotFieldName) problems.push({ path: `${at}.key`, message: `"${key}" is reserved.` });
    else if (seen.has(key)) problems.push({ path: `${at}.key`, message: `"${key}" is used twice.` });
    seen.add(key);
    if (!label || label.length > 60) problems.push({ path: `${at}.label`, message: "A label of 1 to 60 characters is required." });
    if (!(FIELD_TYPES as readonly unknown[]).includes(f.type)) problems.push({ path: `${at}.type`, message: `type is one of ${FIELD_TYPES.join(", ")}.` });
    if (f.maps !== null && f.maps !== undefined && !(FIELD_MAPS as readonly unknown[]).includes(f.maps)) problems.push({ path: `${at}.maps`, message: `maps is one of ${FIELD_MAPS.join(", ")}, or empty.` });
    const map = (f.maps ?? null) as FieldMap | null;
    if (map) {
      if (maps.has(map)) problems.push({ path: `${at}.maps`, message: `Two fields fill "${map}".` });
      maps.add(map);
      if (map === "email" && f.type !== "email") problems.push({ path: `${at}.type`, message: "A field that fills the email is of type email." });
      if (map === "phone" && f.type !== "phone") problems.push({ path: `${at}.type`, message: "A field that fills the phone is of type phone." });
    }
    let options: string[] | undefined;
    if (f.type === "select") {
      const raws = Array.isArray(f.options) ? f.options : [];
      options = raws.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean);
      if (options.length === 0 || options.length > MAX_OPTIONS || options.length !== raws.length || new Set(options).size !== options.length || options.some((o) => o.length > 60)) {
        problems.push({ path: `${at}.options`, message: `A choice field has 1 to ${MAX_OPTIONS} different options of up to 60 characters.` });
      }
    }
    fields.push({ key, label, type: f.type as FieldType, required: f.required === true, maps: map, ...(options ? { options } : {}) });
  });
  if (!maps.has("name")) problems.push({ path: "fields", message: "A form needs a field that fills the name." });
  if (!maps.has("email") && !maps.has("phone")) problems.push({ path: "fields", message: "A form needs an email or a phone field, or nobody can reply." });
  if (fields.some((f) => f.maps === "name" && !f.required)) problems.push({ path: "fields", message: "The name field is required." });
  return { fields, problems };
}

/** Normalises each entry to an origin (`https://example.com`), dropping a path, and reports ones that are not web origins. */
export function cleanOrigins(input: unknown): { origins: string[]; problems: DefinitionProblem[] } {
  if (!Array.isArray(input)) return { origins: [], problems: [{ path: "allowedOrigins", message: "allowedOrigins is a list." }] };
  const problems: DefinitionProblem[] = [];
  const origins: string[] = [];
  if (input.length > MAX_ORIGINS) problems.push({ path: "allowedOrigins", message: `At most ${MAX_ORIGINS} websites.` });
  for (const raw of input.slice(0, MAX_ORIGINS)) {
    try {
      const u = new URL(String(raw));
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      if (!origins.includes(u.origin)) origins.push(u.origin);
    } catch {
      problems.push({ path: "allowedOrigins", message: `"${String(raw).slice(0, 60)}" is not a website address.` });
    }
  }
  return { origins, problems };
}

export type SubmissionOutcome =
  | "ACCEPTED"
  | "RATE_LIMITED"
  | "INVALID_KEY"
  | "ORIGIN_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_FAILED"
  | "HONEYPOT_TRIGGERED"
  | "CAPTCHA_FAILED"
  | "SPAM_CONTENT";

export class SubmissionRejected extends Error {
  constructor(
    readonly outcome: SubmissionOutcome,
    readonly reason: string,
    readonly issues: DefinitionProblem[] = [],
  ) {
    super(reason);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\-.\s]{5,32}$/;
const LINK = /(https?:\/\/|www\.)/gi;

export interface CheckedSubmission {
  values: Record<string, string>;
  lead: { name: string; email?: string; phone?: string; company?: string; service?: string; message?: string };
  honeypotFilled: boolean;
}

/**
 * Checks a parsed body against the form: only declared fields are read, required ones must be present, types and lengths hold, a
 * choice is one of its options, and a submission full of links is spam. Throws `SubmissionRejected` with the reason to log.
 */
export function checkSubmission(fields: readonly FormField[], honeypotFieldName: string, body: unknown): CheckedSubmission {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new SubmissionRejected("VALIDATION_FAILED", "The body is not a JSON object.");
  const raw = body as Record<string, unknown>;
  if (Object.keys(raw).length > MAX_KEYS_IN_BODY) throw new SubmissionRejected("VALIDATION_FAILED", "Too many fields in the body.");
  const issues: DefinitionProblem[] = [];
  const values: Record<string, string> = {};
  for (const f of fields) {
    const v = raw[f.key];
    const text = typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
    if (text === null) {
      issues.push({ path: f.key, message: "Send text." });
      continue;
    }
    if (!text) {
      if (f.required) issues.push({ path: f.key, message: `${f.label} is required.` });
      continue;
    }
    const limit = f.maps ? (MAP_LIMITS[f.maps] ?? LIMITS[f.type]) : LIMITS[f.type];
    if (text.length > limit) issues.push({ path: f.key, message: `${f.label} is at most ${limit} characters.` });
    else if (f.type === "email" && !EMAIL.test(text)) issues.push({ path: f.key, message: `${f.label} is not an email address.` });
    else if (f.type === "phone" && !PHONE.test(text)) issues.push({ path: f.key, message: `${f.label} is not a phone number.` });
    else if (f.type === "select" && !(f.options ?? []).includes(text)) issues.push({ path: f.key, message: `${f.label} is not one of the choices.` });
    else values[f.key] = text;
  }
  if (issues.length > 0) throw new SubmissionRejected("VALIDATION_FAILED", issues.map((i) => `${i.path}: ${i.message}`).join(" "), issues);

  const links = Object.values(values).reduce((n, v) => n + (v.match(LINK)?.length ?? 0), 0);
  if (links > MAX_LINKS) throw new SubmissionRejected("SPAM_CONTENT", `${links} links in one submission (limit ${MAX_LINKS}).`);

  const lead: CheckedSubmission["lead"] = { name: "" };
  const extras: string[] = [];
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (f.maps) (lead as Record<string, string>)[f.maps] = v;
    else extras.push(`${f.label}: ${v}`);
  }
  if (extras.length > 0) lead.message = [lead.message, extras.join("\n")].filter(Boolean).join("\n\n");
  const honeypot = raw[honeypotFieldName];
  return { values, lead, honeypotFilled: typeof honeypot === "string" && honeypot.trim().length > 0 };
}
