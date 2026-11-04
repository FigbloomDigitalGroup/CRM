import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { checkSubmission, cleanFields, cleanOrigins, DEFAULT_FIELDS, SubmissionRejected } from "../src/lib/webForms";
import { createForm, deleteForm, getForm, listForms, listFormSubmissions, rotateFormKey, updateForm } from "../src/services/webFormService";
import { getPublicForm, submitWebForm } from "../src/services/webFormSubmissionService";
import { POST as publicPost, OPTIONS as publicOptions } from "../src/app/api/public/orgs/[orgSlug]/forms/[formKey]/submissions/route";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/** FIG-1151 (B6.19): web forms builder and the public form endpoint. Abuse and rate-limit tests. */

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
const originalEnv = { ...process.env };
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("WEB_FORM_")) delete process.env[k];
  Object.assign(process.env, { ACTIVE_RELEASE: "v1.1" });
  void originalEnv;
});

const uniqueIp = () => `198.51.100.${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 6)}`;
const body = (o: Record<string, unknown> = {}) => JSON.stringify({ name: "Amara Osei", email: `amara.${randomUUID().slice(0, 6)}@example.test`, phone: "+254 722 000 111", message: "I would like a quote.", ...o });

async function world() {
  const org = await createTestOrganization("Forms Org");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  return { org, management, sales };
}

async function published(w: Awaited<ReturnType<typeof world>>, extra: Parameters<typeof createForm>[1] extends infer T ? Partial<T> : never = {}) {
  const form = await createForm(w.management, { name: `Contact ${randomUUID().slice(0, 6)}`, ...extra });
  return updateForm(w.management, form.id, { status: "PUBLISHED" });
}
const meta = (ip = uniqueIp(), origin: string | null = null) => ({ ipAddress: ip, origin });
const logRows = (orgId: string, formId: string) => adminDb.webFormSubmission.findMany({ where: { organizationId: orgId, webFormId: formId }, orderBy: { createdAt: "asc" } });

describe("form rules (pure)", () => {
  it("accepts the default fields and rejects an unusable definition", () => {
    expect(cleanFields(DEFAULT_FIELDS, "website_url").problems).toEqual([]);
    const messages = (input: unknown) => cleanFields(input, "website_url").problems.map((p) => p.message).join(" | ");
    expect(messages([{ key: "email", label: "Email", type: "email", required: true, maps: "email" }])).toMatch(/fills the name/);
    expect(messages([{ key: "name", label: "Name", type: "text", required: true, maps: "name" }])).toMatch(/email or a phone/);
    expect(messages([...DEFAULT_FIELDS, { key: "name", label: "Again", type: "text", required: false, maps: null }])).toMatch(/used twice/);
    expect(messages([...DEFAULT_FIELDS, { key: "website_url", label: "Trap", type: "text", required: false, maps: null }])).toMatch(/reserved/);
    expect(messages([...DEFAULT_FIELDS, { key: "budget", label: "Budget", type: "select", required: false, maps: null, options: [] }])).toMatch(/options/);
    expect(messages([{ key: "name", label: "N", type: "text", required: false, maps: "name" }, DEFAULT_FIELDS[1]])).toMatch(/name field is required/);
    expect(messages([{ key: "Bad Key", label: "x", type: "text", required: false, maps: null }, ...DEFAULT_FIELDS])).toMatch(/lower case/);
    expect(messages("nope")).toMatch(/is a list/);
    expect(messages(Array.from({ length: 16 }, (_, i) => ({ key: `f${i}`, label: "f", type: "text", required: false, maps: null })))).toMatch(/1 to 15/);
  });

  it("normalises origins", () => {
    expect(cleanOrigins(["https://figbloom.co.ke/contact", "https://figbloom.co.ke"]).origins).toEqual(["https://figbloom.co.ke"]);
    expect(cleanOrigins(["javascript:alert(1)"]).problems).toHaveLength(1);
    expect(cleanOrigins(["not a url"]).problems).toHaveLength(1);
  });

  it("reads only declared fields and collects the rest into the notes", () => {
    const fields = [...DEFAULT_FIELDS, { key: "budget", label: "Budget range", type: "text" as const, required: false, maps: null }];
    const r = checkSubmission(fields, "website_url", { name: "A B", email: "a@b.co", message: "Hi", budget: "100k", ownerMembershipId: "x", value: "9" });
    expect(r.lead).toEqual({ name: "A B", email: "a@b.co", message: "Hi\n\nBudget range: 100k" });
    expect(r.honeypotFilled).toBe(false);
    expect(() => checkSubmission(fields, "website_url", [])).toThrow(SubmissionRejected);
  });
});

describe("web forms builder", () => {
  it("Management builds and publishes; others cannot; the captcha secret is never returned", async () => {
    const w = await world();
    const form = await createForm(w.management, { name: "Website contact", captchaSecret: "test-captcha-secret", allowedOrigins: ["https://figbloom.co.ke"], leadSourceKey: "WEBSITE" });
    expect(form).toMatchObject({ status: "DRAFT", captchaConfigured: true, allowedOrigins: ["https://figbloom.co.ke"], honeypotFieldName: "website_url" });
    expect(form.publicKey).toMatch(/^wfk_/);
    expect(JSON.stringify(await getForm(w.management, form.id))).not.toContain("test-captcha-secret");
    expect(JSON.stringify(await listForms(w.management))).not.toContain("test-captcha-secret");
    expect((await updateForm(w.management, form.id, { status: "PUBLISHED" })).status).toBe("PUBLISHED");
    expect((await getForm(w.management, form.id)).last30Days).toEqual({ accepted: 0, rejected: 0 });
    for (const call of [() => listForms(w.sales), () => createForm(w.sales, { name: "x" }), () => updateForm(w.sales, form.id, { status: "ARCHIVED" }), () => deleteForm(w.sales, form.id), () => rotateFormKey(w.sales, form.id)]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("validates names, fields, sources and origins", async () => {
    const w = await world();
    await createForm(w.management, { name: "Dup" });
    await expect(createForm(w.management, { name: " dup " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createForm(w.management, { name: " " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createForm(w.management, { name: "Bad fields", fields: [{ key: "x", label: "x", type: "text", required: false, maps: null }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createForm(w.management, { name: "Bad source", leadSourceKey: "NOPE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createForm(w.management, { name: "Bad origin", allowedOrigins: ["ftp://x"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createForm(w.management, { name: "Bad trap", honeypotFieldName: "Not Valid" })).rejects.toBeInstanceOf(ValidationError);
    const f = await createForm(w.management, { name: "Ok" });
    await expect(updateForm(w.management, f.id, { status: "LIVE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateForm(w.management, f.id, { honeypotFieldName: "email" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateForm(w.management, "missing", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is unavailable while the release is V1", async () => {
    const w = await world();
    process.env.ACTIVE_RELEASE = "v1";
    await expect(listForms(w.management)).rejects.toMatchObject({ name: "FeatureUnavailableError" });
  });
});

describe("public form endpoint: accepted submissions", () => {
  it("creates a lead with the form's source and the form id, answers with the success message only, and logs it", async () => {
    const w = await world();
    const form = await published(w, {
      leadSourceKey: "REFERRAL",
      successMessage: "Thanks, we will call you.",
      fields: [...DEFAULT_FIELDS, { key: "company", label: "Company", type: "text", required: false, maps: "company" }, { key: "budget", label: "Budget range", type: "select", required: false, maps: null, options: ["Under 100k", "100k to 500k"] }],
    });
    const result = await submitWebForm(w.org.slug, form.publicKey, body({ company: "Kijani Foods", budget: "100k to 500k", ownerMembershipId: w.management.membershipId }), meta());
    expect(result).toEqual({ message: "Thanks, we will call you." });
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: w.org.id }, include: { leadSource: true } });
    expect(lead.leadSource?.key).toBe("REFERRAL");
    expect(lead.notes).toContain("I would like a quote.");
    expect(lead.notes).toContain("Budget range: 100k to 500k");
    expect(lead.qualificationData).toMatchObject({ source: "web_form", formId: form.id, formName: form.name, duplicateWarning: { contact: false, company: false } });
    // A body cannot choose the owner; the assignment rules do.
    expect(lead.ownerMembershipId).not.toBe(w.management.membershipId === lead.ownerMembershipId ? "never" : null);
    const rows = await logRows(w.org.id, form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "ACCEPTED", leadId: lead.id, formName: form.name });
    const mirrored = await adminDb.websiteLeadRequestLog.findMany({ where: { organizationId: w.org.id, leadId: lead.id } });
    expect(mirrored).toHaveLength(1);
    expect((await getForm(w.management, form.id)).last30Days).toEqual({ accepted: 1, rejected: 0 });
    // A form creates a lead and nothing else: no deal, no stage move.
    expect(await adminDb.deal.count({ where: { organizationId: w.org.id } })).toBe(0);
  });

  it("falls back to the Website source and warns staff, not the caller, about a duplicate", async () => {
    const w = await world();
    const form = await published(w);
    const first = body({ email: "dup@example.test" });
    expect(await submitWebForm(w.org.slug, form.publicKey, first, meta())).toEqual({ message: "Thank you. We will be in touch." });
    const second = await submitWebForm(w.org.slug, form.publicKey, body({ email: "dup@example.test" }), meta());
    expect(second).toEqual({ message: "Thank you. We will be in touch." });
    const leads = await adminDb.lead.findMany({ where: { organizationId: w.org.id }, include: { leadSource: true }, orderBy: { createdAt: "asc" } });
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.leadSource?.key === "WEBSITE")).toBe(true);
    expect(leads[0]!.qualificationData).toMatchObject({ duplicateWarning: { contact: false } });
    expect(leads[1]!.qualificationData).toMatchObject({ duplicateWarning: { contact: true } });
    const log = await listFormSubmissions(w.management, form.id);
    expect(log.items.map((i) => i.duplicateWarning)).toEqual([{ contact: true, company: false }, null]);
  });

  it("serves the form definition without ids or secrets", async () => {
    const w = await world();
    const form = await published(w, { captchaSecret: "secret-xyz" });
    const def = await getPublicForm(w.org.slug, form.publicKey, meta());
    expect(def).toMatchObject({ name: form.name, honeypotFieldName: "website_url", captchaRequired: true });
    const text = JSON.stringify(def);
    for (const hidden of [form.id, w.org.id, "secret-xyz", form.publicKey]) expect(text).not.toContain(hidden);
  });
});

describe("public form endpoint: abuse is rejected and logged", () => {
  it("answers one generic 404 for an unknown key, another organisation's slug, a draft, an archived form, and an inactive organisation", async () => {
    const a = await world();
    const b = await world();
    const form = await published(a);
    const draft = await createForm(a.management, { name: "Draft only" });
    await expect(submitWebForm(a.org.slug, "wfk_nope", body(), meta())).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitWebForm(b.org.slug, form.publicKey, body(), meta())).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitWebForm(a.org.slug, draft.publicKey, body(), meta())).rejects.toBeInstanceOf(NotFoundError);
    await updateForm(a.management, form.id, { status: "ARCHIVED" });
    await expect(submitWebForm(a.org.slug, form.publicKey, body(), meta())).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPublicForm(b.org.slug, form.publicKey, meta())).rejects.toBeInstanceOf(NotFoundError);
    await updateForm(a.management, form.id, { status: "PUBLISHED" });
    await adminDb.organization.update({ where: { id: a.org.id }, data: { status: "SUSPENDED" } });
    await expect(submitWebForm(a.org.slug, form.publicKey, body(), meta())).rejects.toBeInstanceOf(NotFoundError);
    expect(await adminDb.lead.count({ where: { organizationId: { in: [a.org.id, b.org.id] } } })).toBe(0);
  });

  it("throttles anyone guessing keys", async () => {
    process.env.WEB_FORM_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.WEB_FORM_RATE_LIMIT_MAX_PER_IP = "3";
    const w = await world();
    const ip = uniqueIp();
    for (let i = 0; i < 3; i++) await expect(submitWebForm(w.org.slug, `wfk_guess${i}`, body(), meta(ip))).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitWebForm(w.org.slug, "wfk_guess9", body(), meta(ip))).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("rate limits per address and per form, and logs the rejected attempts", async () => {
    process.env.WEB_FORM_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.WEB_FORM_RATE_LIMIT_MAX_PER_IP = "2";
    process.env.WEB_FORM_RATE_LIMIT_MAX_PER_FORM = "4";
    const w = await world();
    const form = await published(w);
    const ip = uniqueIp();
    await submitWebForm(w.org.slug, form.publicKey, body(), meta(ip));
    await submitWebForm(w.org.slug, form.publicKey, body(), meta(ip));
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta(ip))).rejects.toBeInstanceOf(RateLimitedError);
    // Another address gets through until the form's own limit.
    await submitWebForm(w.org.slug, form.publicKey, body(), meta());
    await submitWebForm(w.org.slug, form.publicKey, body(), meta());
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta())).rejects.toBeInstanceOf(RateLimitedError);
    const rejected = await listFormSubmissions(w.management, form.id, { accepted: false });
    expect(rejected.items.map((i) => i.outcome)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    expect(rejected.items[0]).toMatchObject({ explanation: expect.stringContaining("Too many"), ipAddress: expect.any(String) });
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(4);
  });

  it("rejects an origin that is not on the form's list, and accepts one that is", async () => {
    const w = await world();
    const form = await published(w, { allowedOrigins: ["https://figbloom.co.ke"] });
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta(uniqueIp(), "https://evil.example"))).rejects.toBeInstanceOf(ValidationError);
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta(uniqueIp(), null))).rejects.toBeInstanceOf(ValidationError);
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta(uniqueIp(), "https://figbloom.co.ke"))).resolves.toBeDefined();
    const outcomes = (await logRows(w.org.id, form.id)).map((r) => r.outcome);
    expect(outcomes).toEqual(["ORIGIN_NOT_ALLOWED", "ORIGIN_NOT_ALLOWED", "ACCEPTED"]);
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("rejects an oversized body, bad JSON, missing and invalid answers, a choice outside the options and a link-stuffed message", async () => {
    const w = await world();
    const form = await published(w, { fields: [...DEFAULT_FIELDS, { key: "plan", label: "Plan", type: "select", required: false, maps: null, options: ["A", "B"] }] });
    const submit = (raw: string) => submitWebForm(w.org.slug, form.publicKey, raw, meta());
    await expect(submit(JSON.stringify({ name: "x", email: "a@b.co", message: "x".repeat(11_000) }))).rejects.toBeInstanceOf(ValidationError);
    await expect(submit("{not json")).rejects.toBeInstanceOf(ValidationError);
    const missing = await submit(JSON.stringify({ email: "a@b.co" })).catch((e) => e);
    expect(missing).toBeInstanceOf(ValidationError);
    expect(missing.issues.map((i: { path: string }) => i.path)).toContain("name");
    await expect(submit(body({ email: "not-an-email" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(submit(body({ phone: "call me maybe" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(submit(body({ plan: "C" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(submit(body({ name: "x".repeat(201) }))).rejects.toBeInstanceOf(ValidationError);
    await expect(submit(body({ message: "see http://a.example http://b.example https://c.example" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(submit("[]")).rejects.toBeInstanceOf(ValidationError);
    const outcomes = (await logRows(w.org.id, form.id)).map((r) => r.outcome);
    expect(outcomes).toEqual(["PAYLOAD_TOO_LARGE", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "SPAM_CONTENT", "VALIDATION_FAILED"]);
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(0);
    // The caller of a spam rejection is not told the rule.
    const spam = await submit(body({ message: "http://a.example http://b.example http://c.example" })).catch((e) => e);
    expect(spam.message).toBe("This submission was not accepted.");
  });

  it("tells a bot it succeeded when it fills the hidden trap, creates no lead, and logs it", async () => {
    const w = await world();
    const form = await published(w);
    const result = await submitWebForm(w.org.slug, form.publicKey, body({ website_url: "http://spam.example" }), meta());
    expect(result).toEqual({ message: "Thank you. We will be in touch." });
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(0);
    expect((await logRows(w.org.id, form.id)).map((r) => r.outcome)).toEqual(["HONEYPOT_TRIGGERED"]);
  });

  it("requires the captcha token when the form has a secret", async () => {
    const w = await world();
    const form = await published(w, { captchaSecret: "secret" });
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta())).rejects.toBeInstanceOf(ValidationError);
    expect((await logRows(w.org.id, form.id)).map((r) => r.outcome)).toEqual(["CAPTCHA_FAILED"]);
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(0);
  });

  it("shows form rejections in the Settings website monitoring log as well", async () => {
    const w = await world();
    const form = await published(w);
    await submitWebForm(w.org.slug, form.publicKey, "{bad", meta()).catch(() => undefined);
    const rows = await adminDb.websiteLeadRequestLog.findMany({ where: { organizationId: w.org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "VALIDATION_FAILED", reason: expect.stringContaining(form.name) });
  });
});

describe("public form endpoint: the route", () => {
  it("answers with CORS headers and the error envelope, and never returns an id", async () => {
    const w = await world();
    const form = await published(w);
    const call = (key: string, text: string) =>
      publicPost(new Request(`http://localhost/api/public/orgs/${w.org.slug}/forms/${key}/submissions`, { method: "POST", body: text, headers: { "x-forwarded-for": uniqueIp() } }), {
        params: Promise.resolve({ orgSlug: w.org.slug, formKey: key }),
      });
    const ok = await call(form.publicKey, body());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    const json = await ok.json();
    expect(json).toEqual({ status: "received", message: "Thank you. We will be in touch." });
    const bad = await call(form.publicKey, JSON.stringify({ email: "x" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBeDefined();
    const missing = await call("wfk_nope", body());
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe("*");
    const preflight = await publicOptions();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("web forms: keys, deletion and tenant isolation", () => {
  it("a rotated key replaces the old one at once", async () => {
    const w = await world();
    const form = await published(w);
    const rotated = await rotateFormKey(w.management, form.id);
    expect(rotated.publicKey).not.toBe(form.publicKey);
    await expect(submitWebForm(w.org.slug, form.publicKey, body(), meta())).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitWebForm(w.org.slug, rotated.publicKey, body(), meta())).resolves.toBeDefined();
  });

  it("deleting a form keeps its submission log and its leads", async () => {
    const w = await world();
    const form = await published(w);
    await submitWebForm(w.org.slug, form.publicKey, body(), meta());
    await deleteForm(w.management, form.id);
    await expect(getForm(w.management, form.id)).rejects.toBeInstanceOf(NotFoundError);
    const rows = await adminDb.webFormSubmission.findMany({ where: { organizationId: w.org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.webFormId).toBeNull();
    expect(rows[0]!.formName).toBe(form.name);
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("another organisation sees none of it, in the service and under RLS", async () => {
    const a = await world();
    const b = await world();
    const form = await published(a);
    await submitWebForm(a.org.slug, form.publicKey, body(), meta());
    expect((await listForms(b.management)).items).toEqual([]);
    await expect(getForm(b.management, form.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateForm(b.management, form.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteForm(b.management, form.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rotateFormKey(b.management, form.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listFormSubmissions(b.management, form.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withOrgContext(b.org.id, (tx) => tx.webForm.findMany({}))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.webFormSubmission.findMany({}))).toEqual([]);
    await expect(
      withOrgContext(b.org.id, (tx) => tx.webForm.create({ data: { organizationId: a.org.id, name: "Injected", publicKey: `wfk_${randomUUID()}`, fields: [] } })),
    ).rejects.toThrow();
    expect(await adminDb.lead.count({ where: { organizationId: b.org.id } })).toBe(0);
  });
});
