import type { Prisma, Quote, QuoteLine, QuoteVersion } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requireOwnedRecordPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { canSeeDealValue, canSeeMargin } from "../auth/masking";
import { assertRecordVisible } from "../auth/visibility";
import { adminDb } from "../db/adminClient";
import { assertWritable } from "../lib/archive";
import { discountNeedsApproval, type ApprovalRuleSettings } from "../lib/approvalRules";
import { normaliseCurrency, parseMoney, round2 } from "../lib/commercialMoney";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import {
  DEFAULT_TERMS,
  DEFAULT_VALIDITY_DAYS,
  MAX_QUOTE_DISCOUNT,
  MAX_QUOTE_LINES,
  MAX_TERMS_LENGTH,
  addDays,
  computeTotals,
  isExpiredOn,
  isIsoDate,
  isLockedStatus,
  lineTotal,
  quoteMarginPct,
  todayIso,
} from "../lib/quotes";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getCatalogueItems } from "../repositories/catalogueItems";
import { getDealById } from "../repositories/deals";
import {
  createNextVersion,
  createQuoteWithFirstVersion,
  findValidQuoteVersion,
  getQuoteByDeal,
  getQuoteById,
  getVersionById,
  getVersionWithLines,
  listQuotes,
  replaceDraftContent,
  transitionVersion,
  type NewLine,
  type VersionContent,
} from "../repositories/quotes";
import { loadApprovalRules } from "./approvalRuleService";
import { updateDeal } from "./dealService";
import { requireFeature } from "./featureService";

/**
 * Quotes on deals (FIG-1143, B6.11).
 *
 *  - One quote per deal, with numbered versions. A version is editable while DRAFT; once it is submitted for approval or
 *    sent it is locked (a database trigger enforces it, `20261107100000_quotes`), and the way to change it is a new version.
 *    Earlier versions are never edited or deleted.
 *  - Lines come from the catalogue (price and cost frozen on the line when it is added) or are custom lines typed by the builder.
 *  - Money is masked where it leaves this module (`presentVersion`): prices and totals follow the deal value rule
 *    (`canSeeDealValue`), cost and margin need `deals.margin`. Audit snapshots carry the total only, and the audit reader masks it.
 *  - Proposal Sent can require a valid quote (`quoteGateBlocker`, used by the deal move rules).
 *  - Nothing here sends or approves; B6.12 sends, B6.13 approves, and both go through `transitionVersion` and the same lock.
 */

type VersionRow = QuoteVersion & { lines: QuoteLine[] };

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const READ_KEYS = ["quotes.create", "quotes.approve"];

function requireQuoteRead(ctx: AuthContext): void {
  if (!READ_KEYS.some((k) => hasPermission(ctx, k))) throw deny(ctx, "quotes (quotes.create or quotes.approve)", READ_KEYS);
}

async function loadVisibleDeal(ctx: AuthContext, dealId: string) {
  const deal = await getDealById(ctx.organizationId, dealId);
  if (!deal) throw new NotFoundError("Deal", dealId);
  assertRecordVisible(ctx, "deals", "Deal", dealId, deal);
  return deal;
}

type DealRow = NonNullable<Awaited<ReturnType<typeof getDealById>>>;

function requireQuoteWrite(ctx: AuthContext, deal: DealRow): void {
  requirePermission(ctx, "quotes.create");
  requireOwnedRecordPermission(ctx, "deals.edit.own", "deals.edit.all", deal.ownerMembershipId);
}

/** Loads a quote and the deal it belongs to, refusing (404) when the caller cannot open that deal. */
async function loadQuoteAndDeal(ctx: AuthContext, quoteId: string) {
  const quote = await getQuoteById(ctx.organizationId, quoteId);
  if (!quote) throw new NotFoundError("Quote", quoteId);
  const deal = await loadVisibleDeal(ctx, quote.dealId).catch((err) => {
    if (err instanceof NotFoundError) throw new NotFoundError("Quote", quoteId);
    throw err;
  });
  return { quote, deal };
}

// ---------------------------------------------------------------------------
// Presenting (the only place money leaves)
// ---------------------------------------------------------------------------

export interface QuoteLineView {
  id: string;
  position: number;
  catalogueItemId: string | null;
  description: string;
  unit: string;
  quantity: number;
  taxable: boolean;
  unitPrice: number | null;
  lineTotal: number | null;
  /** Null without `deals.margin`. */
  unitCost: number | null;
}

function money(show: boolean, value: Prisma.Decimal | number | null): number | null {
  if (!show || value === null) return null;
  return Number(value);
}

export function presentVersion(ctx: Pick<AuthContext, "permissionKeys" | "membershipId">, deal: { ownerMembershipId: string | null }, v: VersionRow, rules: ApprovalRuleSettings | null = null, now = new Date()) {
  const showValue = ctx.permissionKeys.includes("deals.view.value") || deal.ownerMembershipId === ctx.membershipId;
  const showMargin = showValue && ctx.permissionKeys.includes("deals.margin");
  const total = Number(v.total);
  const cost = v.costTotal === null ? null : Number(v.costTotal);
  const validUntil = v.validUntil.toISOString().slice(0, 10);
  return {
    version: v.version,
    status: v.status,
    locked: v.lockedAt !== null,
    expired: ["SENT", "APPROVED"].includes(v.status) && isExpiredOn(validUntil, now),
    discountPercent: Number(v.discountPercent),
    validUntil,
    terms: v.terms,
    currency: v.currency,
    lines: v.lines.map(
      (l): QuoteLineView => ({
        id: l.id,
        position: l.position,
        catalogueItemId: l.catalogueItemId,
        description: l.description,
        unit: l.unit,
        quantity: Number(l.quantity),
        taxable: l.taxable,
        unitPrice: money(showValue, l.unitPrice),
        lineTotal: money(showValue, l.lineTotal),
        unitCost: money(showMargin, l.unitCost),
      }),
    ),
    subtotal: money(showValue, v.subtotal),
    discountAmount: money(showValue, v.discountAmount),
    total: money(showValue, v.total),
    cost: showMargin ? cost : null,
    marginPct: showMargin ? quoteMarginPct(total, cost) : null,
    amountMasked: !showValue,
    marginMasked: !showMargin,
    approvalRequired: rules ? discountNeedsApproval(Number(v.discountPercent), rules) : null,
    submittedAt: v.submittedAt,
    approvedAt: v.approvedAt,
    decidedByMembershipId: v.decidedByMembershipId,
    decisionReason: v.decisionReason,
    sentAt: v.sentAt,
    respondedAt: v.respondedAt,
    createdByMembershipId: v.createdByMembershipId,
    createdAt: v.createdAt,
  };
}

function presentSummary(ctx: AuthContext, deal: { ownerMembershipId: string | null }, v: QuoteVersion, now = new Date()) {
  const full = presentVersion(ctx, deal, { ...v, lines: [] }, null, now);
  const { lines: _lines, terms: _terms, cost: _cost, ...rest } = full;
  void _lines;
  void _terms;
  void _cost;
  return rest;
}

function presentQuote(ctx: AuthContext, deal: { ownerMembershipId: string | null }, q: Quote & { versions: QuoteVersion[] }, now = new Date()) {
  return {
    id: q.id,
    number: q.number,
    dealId: q.dealId,
    currency: q.currency,
    currentVersion: q.versions.length > 0 ? q.versions[q.versions.length - 1]!.version : null,
    versions: q.versions.map((v) => presentSummary(ctx, deal, v, now)),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

function auditSnapshot(quote: { number: string }, v: VersionRow) {
  return { quote: quote.number, version: v.version, status: v.status, discountPercent: Number(v.discountPercent), lines: v.lines.length, total: Number(v.total) };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface QuoteLineInput {
  /** An existing line of this draft: keeps its frozen price and cost. */
  lineId?: string;
  catalogueItemId?: string;
  description?: string;
  unit?: string;
  quantity: number | string;
  /** Custom lines only. A catalogue line always takes the catalogue price, so a discount can only come through the discount field. */
  unitPrice?: number | string;
  taxable?: boolean;
}

export interface QuoteContentInput {
  lines?: QuoteLineInput[];
  discountPercent?: number | string;
  validUntil?: string;
  terms?: string | null;
}

function parseQuantity(value: unknown, path: string, issues: ValidationIssue[]): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    issues.push({ path, message: "The quantity must be more than zero, with at most two decimals.", code: "INVALID_QUANTITY" });
    return null;
  }
  return round2(n);
}

async function resolveLines(ctx: AuthContext, currency: string, inputs: QuoteLineInput[], existing: QuoteLine[]): Promise<NewLine[]> {
  const organizationId = ctx.organizationId;
  const issues: ValidationIssue[] = [];
  if (inputs.length > MAX_QUOTE_LINES) throw new ValidationError(`A quote has at most ${MAX_QUOTE_LINES} lines.`, [{ path: "lines", message: `At most ${MAX_QUOTE_LINES} lines.` }]);
  const ids = [...new Set(inputs.filter((l) => !l.lineId).map((l) => l.catalogueItemId).filter((x): x is string => !!x))];
  const items = new Map((await getCatalogueItems(organizationId, ids)).map((i) => [i.id, i]));
  const byLine = new Map(existing.map((l) => [l.id, l]));
  const out: NewLine[] = [];
  inputs.forEach((input, i) => {
    const path = `lines.${i}`;
    const quantity = parseQuantity(input.quantity, `${path}.quantity`, issues);
    if (input.lineId) {
      const kept = byLine.get(input.lineId);
      if (!kept) {
        issues.push({ path: `${path}.lineId`, message: "That line is not on this version.", code: "UNKNOWN_LINE" });
        return;
      }
      if (quantity === null) return;
      const description = input.description === undefined ? kept.description : input.description.trim();
      if (!description || description.length > 300) issues.push({ path: `${path}.description`, message: "A description of 1 to 300 characters is required." });
      out.push({
        catalogueItemId: kept.catalogueItemId,
        description,
        unit: kept.unit,
        quantity,
        unitPrice: Number(kept.unitPrice),
        unitCost: kept.unitCost === null ? null : Number(kept.unitCost),
        taxable: kept.taxable,
        lineTotal: lineTotal(quantity, Number(kept.unitPrice)),
      });
      return;
    }
    if (input.catalogueItemId) {
      const item = items.get(input.catalogueItemId);
      if (!item) {
        issues.push({ path: `${path}.catalogueItemId`, message: "That catalogue item does not exist.", code: "UNKNOWN_ITEM" });
        return;
      }
      if (item.status !== "ACTIVE") issues.push({ path: `${path}.catalogueItemId`, message: `${item.name} is hidden and cannot be added to a quote.`, code: "ITEM_HIDDEN" });
      if (item.currency !== currency) issues.push({ path: `${path}.catalogueItemId`, message: `${item.name} is priced in ${item.currency}, this quote is in ${currency}.`, code: "CURRENCY_MISMATCH" });
      if (input.unitPrice !== undefined) issues.push({ path: `${path}.unitPrice`, message: "A catalogue line takes the catalogue price. Use the discount for a lower price.", code: "PRICE_FROM_CATALOGUE" });
      if (quantity === null) return;
      const unitPrice = Number(item.price);
      out.push({
        catalogueItemId: item.id,
        description: (input.description?.trim() || item.name).slice(0, 300),
        unit: item.unit,
        quantity,
        unitPrice,
        unitCost: item.cost === null ? null : Number(item.cost),
        taxable: item.taxable,
        lineTotal: lineTotal(quantity, unitPrice),
      });
      return;
    }
    // A custom line takes any price, so it would walk round the discount approval: only people who manage the catalogue may add one.
    if (!hasPermission(ctx, "catalogue.manage")) throw deny(ctx, "custom quote lines (catalogue.manage)", ["catalogue.manage"]);
    const description = (input.description ?? "").trim();
    if (!description || description.length > 300) issues.push({ path: `${path}.description`, message: "A custom line needs a description of 1 to 300 characters.", code: "DESCRIPTION_REQUIRED" });
    const unitPrice = input.unitPrice === undefined ? (issues.push({ path: `${path}.unitPrice`, message: "A custom line needs a unit price.", code: "INVALID_AMOUNT" }), null) : parseMoney(input.unitPrice, `${path}.unitPrice`, issues, "The unit price");
    const unit = (input.unit ?? "unit").trim();
    if (!unit || unit.length > 30) issues.push({ path: `${path}.unit`, message: "A unit of 1 to 30 characters." });
    if (quantity === null || unitPrice === null) return;
    out.push({ catalogueItemId: null, description, unit, quantity, unitPrice, unitCost: null, taxable: input.taxable ?? true, lineTotal: lineTotal(quantity, unitPrice) });
  });
  if (issues.length > 0) throw new ValidationError("These quote lines are not valid.", issues);
  return out;
}

function parseDiscount(value: unknown, issues: ValidationIssue[]): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_QUOTE_DISCOUNT) {
    issues.push({ path: "discountPercent", message: `A discount is 0 to ${MAX_QUOTE_DISCOUNT} percent.`, code: "INVALID_DISCOUNT" });
    return null;
  }
  return n;
}

function parseValidUntil(value: string, issues: ValidationIssue[], now: Date): string | null {
  if (!isIsoDate(value)) {
    issues.push({ path: "validUntil", message: "Use a date such as 2026-12-31.", code: "INVALID_DATE" });
    return null;
  }
  if (value < todayIso(now)) {
    issues.push({ path: "validUntil", message: "A quote cannot be valid until a date that has passed.", code: "VALIDITY_IN_PAST" });
    return null;
  }
  return value;
}

function parseTerms(value: string | null, issues: ValidationIssue[]): string | null {
  const t = value === null ? "" : value.trim();
  if (t.length > MAX_TERMS_LENGTH) issues.push({ path: "terms", message: `The terms are at most ${MAX_TERMS_LENGTH} characters.` });
  return t === "" ? null : t;
}

function contentFor(lines: NewLine[], discountPercent: number, validUntil: string, terms: string | null): VersionContent {
  const totals = computeTotals(lines, discountPercent);
  return { discountPercent, validUntil, terms, ...totals };
}

// ---------------------------------------------------------------------------
// Create, read, edit
// ---------------------------------------------------------------------------

export const QUOTE_SETTINGS_KEY = "quotes.settings";

export interface QuoteSettings {
  /** Moving a deal to Proposal Sent needs a valid quote. */
  requireForProposalSent: boolean;
  validityDays: number;
  defaultTerms: string;
}

export async function loadQuoteSettings(organizationId: string): Promise<QuoteSettings> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: QUOTE_SETTINGS_KEY } } });
  const v = (row?.value ?? {}) as Record<string, unknown>;
  // The Proposal Sent gate is a stage rule (B6.15, QUOTE_REQUIRED on a stage with the key PROPOSAL_SENT); this reports whether it is on.
  const gated = await adminDb.stageRule.count({ where: { organizationId, type: "QUOTE_REQUIRED", enabled: true, stageId: { in: (await adminDb.pipelineStage.findMany({ where: { organizationId, key: "PROPOSAL_SENT" }, select: { id: true } })).map((x) => x.id) } } });
  return {
    requireForProposalSent: gated > 0,
    validityDays: typeof v.validityDays === "number" && Number.isInteger(v.validityDays) && v.validityDays >= 1 && v.validityDays <= 365 ? v.validityDays : DEFAULT_VALIDITY_DAYS,
    defaultTerms: typeof v.defaultTerms === "string" && v.defaultTerms.trim() !== "" ? v.defaultTerms : DEFAULT_TERMS,
  };
}

/** Management (`configuration.manage`) sets the quote defaults and whether Proposal Sent needs a valid quote. */
export async function updateQuoteSettings(ctx: AuthContext, patch: { requireForProposalSent?: boolean; validityDays?: number; defaultTerms?: string }) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requirePermission(ctx, "configuration.manage");
  const issues: ValidationIssue[] = [];
  if (patch.validityDays !== undefined && (!Number.isInteger(patch.validityDays) || patch.validityDays < 1 || patch.validityDays > 365)) issues.push({ path: "validityDays", message: "Use a whole number of days from 1 to 365." });
  if (patch.defaultTerms !== undefined && (patch.defaultTerms.trim() === "" || patch.defaultTerms.length > MAX_TERMS_LENGTH)) issues.push({ path: "defaultTerms", message: `Terms of 1 to ${MAX_TERMS_LENGTH} characters are required.` });
  if (issues.length > 0) throw new ValidationError("These quote settings are not valid.", issues);
  const before = await loadQuoteSettings(ctx.organizationId);
  const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as QuoteSettings;
  const stored = { validityDays: next.validityDays, defaultTerms: next.defaultTerms };
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: QUOTE_SETTINGS_KEY } },
    update: { value: stored as unknown as Prisma.InputJsonValue },
    create: { organizationId: ctx.organizationId, key: QUOTE_SETTINGS_KEY, value: stored as unknown as Prisma.InputJsonValue },
  });
  if (patch.requireForProposalSent !== undefined) {
    const stages = await adminDb.pipelineStage.findMany({ where: { organizationId: ctx.organizationId, key: "PROPOSAL_SENT" }, select: { id: true } });
    for (const st of stages) {
      if (patch.requireForProposalSent) {
        await adminDb.stageRule.upsert({
          where: { stageId_type: { stageId: st.id, type: "QUOTE_REQUIRED" } },
          update: { enabled: true },
          create: { organizationId: ctx.organizationId, stageId: st.id, type: "QUOTE_REQUIRED", createdByMembershipId: ctx.membershipId },
        });
      } else {
        await adminDb.stageRule.deleteMany({ where: { organizationId: ctx.organizationId, stageId: st.id, type: "QUOTE_REQUIRED" } });
      }
    }
  }
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "quote_settings.updated", entityType: "Organization", entityId: ctx.organizationId, previousValue: before as unknown as Prisma.InputJsonValue, newValue: next as unknown as Prisma.InputJsonValue });
  return next;
}

export async function getQuoteSettings(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireQuoteRead(ctx);
  return loadQuoteSettings(ctx.organizationId);
}

/** Makes the deal's quote with its first draft version. */
export async function createQuote(
  ctx: AuthContext,
  dealId: string,
  input: QuoteContentInput & { currency?: string } = {},
  now = new Date(),
) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const deal = await loadVisibleDeal(ctx, dealId);
  requireQuoteWrite(ctx, deal);
  assertWritable(ctx, "deal", deal, "adding a quote");
  if (await getQuoteByDeal(ctx.organizationId, dealId)) {
    throw new ValidationError("This deal already has a quote. Open it and make a new version.", [{ path: "dealId", message: "One quote per deal.", code: "QUOTE_EXISTS" }]);
  }
  const issues: ValidationIssue[] = [];
  const currency = input.currency === undefined ? deal.currency : normaliseCurrency(input.currency, "currency", issues);
  const discount = input.discountPercent === undefined ? 0 : parseDiscount(input.discountPercent, issues);
  const settings = await loadQuoteSettings(ctx.organizationId);
  const validUntil = input.validUntil === undefined ? addDays(now, settings.validityDays) : parseValidUntil(input.validUntil, issues, now);
  const terms = input.terms === undefined ? settings.defaultTerms : parseTerms(input.terms, issues);
  if (issues.length > 0 || currency === null || discount === null || validUntil === null) throw new ValidationError("This quote is not valid.", issues);
  const lines = await resolveLines(ctx, currency, input.lines ?? [], []);

  const { quote, version } = await createQuoteWithFirstVersion({
    organizationId: ctx.organizationId,
    dealId,
    currency,
    createdByMembershipId: ctx.membershipId,
    content: contentFor(lines, discount, validUntil, terms),
    lines,
    year: now.getUTCFullYear(),
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "quote.created", entityType: "Quote", entityId: quote.id, newValue: auditSnapshot(quote, version), metadata: { dealId } });
  const rules = await loadApprovalRules(ctx.organizationId);
  return { quote: presentQuote(ctx, deal, { ...quote, versions: [version] }, now), version: presentVersion(ctx, deal, version, rules, now) };
}

export async function getQuoteForDeal(ctx: AuthContext, dealId: string, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireQuoteRead(ctx);
  const deal = await loadVisibleDeal(ctx, dealId);
  const quote = await getQuoteByDeal(ctx.organizationId, dealId);
  if (!quote) throw new NotFoundError("Quote", `for deal ${dealId}`);
  return presentQuote(ctx, deal, quote, now);
}

export async function getQuote(ctx: AuthContext, quoteId: string, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireQuoteRead(ctx);
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  return presentQuote(ctx, deal, quote, now);
}

export async function getQuoteVersion(ctx: AuthContext, quoteId: string, version: number, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireQuoteRead(ctx);
  const { deal } = await loadQuoteAndDeal(ctx, quoteId);
  const row = await getVersionWithLines(ctx.organizationId, quoteId, version);
  if (!row) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
  return presentVersion(ctx, deal, row, await loadApprovalRules(ctx.organizationId), now);
}

const MAX_DEAL_IDS_FILTER = 100;

/** `dealId` as one id or a comma-separated list (at most 100). Undefined when the filter is absent or empty. */
function parseDealIdFilter(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return undefined;
  if (ids.length > MAX_DEAL_IDS_FILTER) {
    throw new ValidationError("dealId lists too many deals.", [{ path: "dealId", message: `Ask for at most ${MAX_DEAL_IDS_FILTER} deals at a time.` }]);
  }
  return ids;
}

/** Quotes on the deals the caller can open, newest change first, each with its latest version summary. */
export async function listQuotesPage(ctx: AuthContext, filters: { dealId?: string; status?: string } = {}, request: PageRequest = {}, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireQuoteRead(ctx);
  if (filters.status !== undefined && !["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "ACCEPTED", "DECLINED"].includes(filters.status)) {
    throw new ValidationError("status is not a quote status.", [{ path: "status", message: "Use DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SENT, ACCEPTED or DECLINED." }]);
  }
  const paging = resolvePaging(request);
  // `dealId` is one deal id or several separated by commas (the Quotes list asks for the quotes of the deals on its page in one request).
  const asked = parseDealIdFilter(filters.dealId);
  let dealIds: string[] | undefined;
  if (!hasPermission(ctx, "deals.view.all")) {
    if (!hasPermission(ctx, "deals.view.own")) throw deny(ctx, "deals.view", ["deals.view.own", "deals.view.all"]);
    // A deal asked for that the caller cannot open drops out here (the answer is an empty list, never another person's quote).
    dealIds = (await adminDb.deal.findMany({ where: { organizationId: ctx.organizationId, ownerMembershipId: ctx.membershipId, ...(asked ? { id: { in: asked } } : {}) }, select: { id: true } })).map((d) => d.id);
  }
  const { rows, total } = await listQuotes(ctx.organizationId, { dealIds, dealId: asked, status: filters.status }, paging);
  const deals = await adminDb.deal.findMany({ where: { organizationId: ctx.organizationId, id: { in: rows.map((q) => q.dealId) } }, select: { id: true, ownerMembershipId: true, company: { select: { name: true } } } });
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const items = rows.map((q) => {
    const deal = dealById.get(q.dealId)!;
    const latest = q.versions[0]!;
    return { id: q.id, number: q.number, dealId: q.dealId, companyName: deal.company.name, currency: q.currency, latest: presentSummary(ctx, deal, latest, now), updatedAt: q.updatedAt };
  });
  return buildPage(items, total, paging);
}

function lockedError(status: string): ValidationError {
  return new ValidationError(`This version is ${status.toLowerCase().replace("_", " ")}, so it cannot be changed. Make a new version to change it.`, [
    { path: "version", message: "Versions that were submitted or sent are final.", code: "VERSION_LOCKED" },
  ]);
}

/** Edits a DRAFT version: lines, discount, validity, terms. A locked version answers VERSION_LOCKED. */
export async function updateDraftVersion(ctx: AuthContext, quoteId: string, version: number, input: QuoteContentInput, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  assertWritable(ctx, "deal", deal, "editing its quote");
  const current = await getVersionWithLines(ctx.organizationId, quoteId, version);
  if (!current) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
  if (isLockedStatus(current.status)) throw lockedError(current.status);

  const issues: ValidationIssue[] = [];
  const discount = input.discountPercent === undefined ? Number(current.discountPercent) : parseDiscount(input.discountPercent, issues);
  const validUntil = input.validUntil === undefined ? current.validUntil.toISOString().slice(0, 10) : parseValidUntil(input.validUntil, issues, now);
  const terms = input.terms === undefined ? current.terms : parseTerms(input.terms, issues);
  if (issues.length > 0 || discount === null || validUntil === null) throw new ValidationError("This quote is not valid.", issues);
  const lines = input.lines ? await resolveLines(ctx, current.currency, input.lines, current.lines) : null;
  const effective: NewLine[] =
    lines ??
    current.lines.map((l) => ({ catalogueItemId: l.catalogueItemId, description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), unitCost: l.unitCost === null ? null : Number(l.unitCost), taxable: l.taxable, lineTotal: Number(l.lineTotal) }));

  let updated;
  try {
    updated = await replaceDraftContent(ctx.organizationId, current.id, contentFor(effective, discount, validUntil, terms), lines);
  } catch (err) {
    // The database trigger is the backstop if the version was locked between the read and the write.
    if (err instanceof Error && /locked/i.test(err.message)) throw lockedError("locked");
    throw err;
  }
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "quote.version_updated", entityType: "Quote", entityId: quoteId, previousValue: auditSnapshot(quote, current), newValue: auditSnapshot(quote, updated) });
  return presentVersion(ctx, deal, updated, await loadApprovalRules(ctx.organizationId), now);
}

/** Starts the next draft from the latest version. Earlier versions stay exactly as they were. */
export async function createNewVersion(ctx: AuthContext, quoteId: string, options: { refreshPrices?: boolean } = {}, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  assertWritable(ctx, "deal", deal, "editing its quote");
  const latest = quote.versions[quote.versions.length - 1]!;
  if (latest.status === "DRAFT") {
    throw new ValidationError("The latest version is still a draft. Edit it instead of making another.", [{ path: "version", message: "Edit the draft.", code: "DRAFT_EXISTS" }]);
  }
  if (latest.status === "PENDING_APPROVAL") {
    throw new ValidationError("The latest version is waiting for approval. Wait for the decision, or ask an approver.", [{ path: "version", message: "Waiting for approval.", code: "AWAITING_APPROVAL" }]);
  }
  const source = await getVersionWithLines(ctx.organizationId, quoteId, latest.version);
  let lines: NewLine[] = source!.lines.map((l) => ({
    catalogueItemId: l.catalogueItemId,
    description: l.description,
    unit: l.unit,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    unitCost: l.unitCost === null ? null : Number(l.unitCost),
    taxable: l.taxable,
    lineTotal: Number(l.lineTotal),
  }));
  if (options.refreshPrices) {
    const items = new Map((await getCatalogueItems(ctx.organizationId, lines.map((l) => l.catalogueItemId).filter((x): x is string => !!x))).map((i) => [i.id, i]));
    lines = lines.map((l) => {
      const item = l.catalogueItemId ? items.get(l.catalogueItemId) : undefined;
      if (!item || item.currency !== source!.currency) return l;
      const unitPrice = Number(item.price);
      return { ...l, unitPrice, unitCost: item.cost === null ? null : Number(item.cost), taxable: item.taxable, lineTotal: lineTotal(l.quantity, unitPrice) };
    });
  }
  const sourceValid = source!.validUntil.toISOString().slice(0, 10);
  const validUntil = sourceValid >= todayIso(now) ? sourceValid : addDays(now, (await loadQuoteSettings(ctx.organizationId)).validityDays);
  const created = await createNextVersion({
    organizationId: ctx.organizationId,
    quoteId,
    version: latest.version + 1,
    currency: source!.currency,
    createdByMembershipId: ctx.membershipId,
    content: contentFor(lines, Number(source!.discountPercent), validUntil, source!.terms),
    lines,
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "quote.version_created", entityType: "Quote", entityId: quoteId, newValue: auditSnapshot(quote, created), metadata: { fromVersion: latest.version } });
  return presentVersion(ctx, deal, created, await loadApprovalRules(ctx.organizationId), now);
}

/** A person records the client's answer to a sent version. */
export async function recordQuoteResponse(ctx: AuthContext, quoteId: string, version: number, input: { outcome: "ACCEPTED" | "DECLINED"; note?: string }, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  if (input.outcome !== "ACCEPTED" && input.outcome !== "DECLINED") throw new ValidationError("outcome must be ACCEPTED or DECLINED.", [{ path: "outcome", message: "Use ACCEPTED or DECLINED." }]);
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  const row = await getVersionWithLines(ctx.organizationId, quoteId, version);
  if (!row) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
  const updated = await transitionVersion(ctx.organizationId, row.id, ["SENT"], input.outcome, { respondedAt: now, decisionReason: input.note?.trim().slice(0, 500) || null });
  if (!updated) throw new ValidationError("Only a sent version can be marked accepted or declined.", [{ path: "version", message: `This version is ${row.status.toLowerCase()}.`, code: "NOT_SENT" }]);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: input.outcome === "ACCEPTED" ? "quote.accepted" : "quote.declined", entityType: "Quote", entityId: quoteId, newValue: auditSnapshot(quote, updated) });
  return presentVersion(ctx, deal, updated, await loadApprovalRules(ctx.organizationId), now);
}

/** Copies a version total to the deal value ("Use the quote total"). Needs the right to see and edit the deal value. */
export async function applyQuoteTotalToDeal(ctx: AuthContext, quoteId: string, version: number) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const { deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  if (!canSeeDealValue(ctx, deal)) throw deny(ctx, "deals.view.value (to copy a quote total to the deal)", ["deals.view.value"]);
  const row = await getVersionWithLines(ctx.organizationId, quoteId, version);
  if (!row) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
  if (!["APPROVED", "SENT", "ACCEPTED"].includes(row.status)) {
    throw new ValidationError("Only an approved, sent or accepted version can set the deal value.", [{ path: "version", message: `This version is ${row.status.toLowerCase()}.`, code: "VERSION_NOT_FINAL" }]);
  }
  return updateDeal(ctx, deal.id, { value: Number(row.total), currency: row.currency });
}

// ---------------------------------------------------------------------------
// Used by the approvals engine and by sending (B6.12, B6.13)
// ---------------------------------------------------------------------------

export { getVersionById, transitionVersion };
export { presentQuote, loadQuoteAndDeal, requireQuoteWrite, auditSnapshot as quoteAuditSnapshot };

export function marginIsVisible(ctx: AuthContext): boolean {
  return canSeeMargin(ctx);
}

// ---------------------------------------------------------------------------
// The Proposal Sent gate
// ---------------------------------------------------------------------------

export interface QuoteGateBlocker {
  code: "QUOTE_REQUIRED" | "QUOTE_NOT_APPROVED" | "QUOTE_EXPIRED";
  message: string;
}

/**
 * Whether a deal has a valid quote: some version that is APPROVED, SENT or ACCEPTED and whose validity date has not passed.
 * Returns the reason a move to Proposal Sent is blocked, or null when the deal has one.
 */
export async function quoteGateBlocker(organizationId: string, dealId: string, now = new Date()): Promise<QuoteGateBlocker | null> {
  const found = await findValidQuoteVersion(organizationId, dealId, todayIso(now));
  if (!found.hasQuote) return { code: "QUOTE_REQUIRED", message: "Proposal Sent needs a valid quote. Create a quote for this deal first." };
  if (found.valid) return null;
  const latest = found.latest;
  if (latest && ["APPROVED", "SENT", "ACCEPTED"].includes(latest.status)) {
    return { code: "QUOTE_EXPIRED", message: "The quote on this deal has passed its validity date. Make a new version with a new date." };
  }
  if (found.versions?.some((v) => ["APPROVED", "SENT", "ACCEPTED"].includes(v.status))) {
    return { code: "QUOTE_EXPIRED", message: "The quote on this deal has passed its validity date. Make a new version with a new date." };
  }
  const reason = latest?.status === "PENDING_APPROVAL" ? "is waiting for approval" : latest?.status === "REJECTED" ? "was not approved" : "is still a draft";
  return { code: "QUOTE_NOT_APPROVED", message: `Proposal Sent needs a valid quote. The quote on this deal ${reason}.` };
}
