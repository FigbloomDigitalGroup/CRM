"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import type { CallArgs, OperationId, Operations } from "@/api-client";

/**
 * Data layer for quotes, approvals, the catalogue and pipelines (FIG-1168, FIG-1169, FIG-1174; docs/QUOTES_AND_APPROVALS.md).
 *
 * The frozen contract (1.1.0) lists these routes but types most of their responses as `unknown`, so the response shapes are declared here from the
 * services' presenters (`presentVersion`, `presentCatalogueItem`, `ApprovalItem`, `presentAll`). Money arrives already masked by the API
 * (`null` plus a `*Masked` flag): the screens render what comes back and never rebuild a hidden figure (hard rule 7).
 */

export type QuoteStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SENT" | "ACCEPTED" | "DECLINED";

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined by client",
};

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
  unitCost: number | null;
}

export interface QuoteVersionSummary {
  version: number;
  status: QuoteStatus;
  locked: boolean;
  expired: boolean;
  discountPercent: number;
  validUntil: string;
  currency: string;
  subtotal: number | null;
  discountAmount: number | null;
  total: number | null;
  marginPct: number | null;
  amountMasked: boolean;
  marginMasked: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  decisionReason: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface QuoteVersionView extends QuoteVersionSummary {
  terms: string | null;
  lines: QuoteLineView[];
  cost: number | null;
  approvalRequired: boolean | null;
}

export interface QuoteView {
  id: string;
  number: string;
  dealId: string;
  currency: string;
  currentVersion: number | null;
  versions: QuoteVersionSummary[];
}

export interface QuoteListItem {
  id: string;
  number: string;
  dealId: string;
  companyName: string;
  currency: string;
  latest: QuoteVersionSummary;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  nextCursor: string | null;
}

export interface CatalogueItemView {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  kind: string;
  unit: string;
  price: number;
  currency: string;
  taxable: boolean;
  status: "ACTIVE" | "HIDDEN";
  cost: number | null;
  marginPct: number | null;
  costMasked: boolean;
}

export type ApprovalKind = "DISCOUNT" | "EXPORT" | "DELETION" | "LARGE_DEAL";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";

export interface ApprovalItem {
  id: string;
  source: "REQUEST" | "EXPORT" | "ERASURE";
  kind: ApprovalKind;
  kindLabel: string;
  status: ApprovalStatus;
  title: string;
  summary: string;
  requestedBy: { membershipId: string | null; name: string | null };
  requestedAt: string;
  requesterNote: string | null;
  decidedBy: { membershipId: string | null; name: string | null } | null;
  decidedAt: string | null;
  decisionReason: string | null;
  subject: { type: string; id: string; dealId: string | null };
  canDecide: boolean;
  resumeError: string | null;
  resumed: boolean;
}

export interface ApprovalPage extends Page<ApprovalItem> {
  pending: number;
  canDecide: boolean;
}

export interface ApprovalRulesView {
  discount: { enabled: boolean; thresholdPercent: number };
  export: { enabled: boolean; thresholdRows: number };
  largeDeal: { enabled: boolean; thresholdAmount: number; currency: string };
  deletion: { enabled: boolean; locked: boolean };
}

export interface StageRuleView {
  id: string;
  type: "QUOTE_REQUIRED" | "REQUIRED_FIELDS" | "APPROVAL_REQUIRED" | string;
  label: string;
  enabled: boolean;
  fields?: string[];
}

export interface PipelineStageView {
  id: string;
  key: string;
  name: string;
  sequence: number;
  probability: number | null;
  stalledAfterDays: number | null;
  isWon: boolean;
  isLost: boolean;
  isActive: boolean;
  rules: StageRuleView[];
}

export interface PipelineView {
  id: string;
  key: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  serviceIds: string[];
  stages: PipelineStageView[];
}

export interface PipelineList {
  items: PipelineView[];
  ruleTypes: { type: string; label: string }[];
  fields: Record<string, string>;
}

export interface QuoteSettingsView {
  requireForProposalSent: boolean;
  validityDays: number;
  defaultTerms: string;
}

export interface QuoteActivity {
  shares: { id: string; active: boolean; expiresAt: string; revokedAt: string | null; createdAt?: string }[];
  events: { id: string; type: string; shareId: string | null; occurredAt: string }[];
}

/* Reads -------------------------------------------------------------------------------------------------------------------------- */

/** `useApiQuery` with the response type this module knows (the contract still says `unknown` for these routes). */
function useRead<T, K extends OperationId = OperationId>(id: K, args: unknown, options: { enabled?: boolean; staleTime?: number; retry?: boolean } = {}) {
  return useApiQuery(id, args as CallArgs<K>, options as never) as unknown as UseQueryResult<T>;
}

export const useQuotes = (orgSlug: string) => useRead<Page<QuoteListItem>>("getQuotes", { params: { orgSlug }, query: { pageSize: "100" } });

/** The quote on a deal. A deal without one answers 404, which the builder treats as "no quote yet". */
export const useDealQuote = (orgSlug: string, dealId: string) => useRead<QuoteView>("getDealsByDealIdQuote", { params: { orgSlug, dealId } }, { retry: false });

export const useQuoteVersion = (orgSlug: string, quoteId: string | undefined, version: number | null | undefined) =>
  useRead<QuoteVersionView>("getQuotesByQuoteIdVersionsByVersion", { params: { orgSlug, quoteId: quoteId ?? "", version: String(version ?? 0) } }, { enabled: !!quoteId && !!version });

export const useQuotePreview = (orgSlug: string, quoteId: string | undefined, version: number | null | undefined, enabled: boolean) =>
  useRead<{ source: "draft" | "sent"; html: string; sha256: string }>("getQuotesByQuoteIdVersionsByVersionPreview", { params: { orgSlug, quoteId: quoteId ?? "", version: String(version ?? 0) } }, { enabled: enabled && !!quoteId && !!version, staleTime: 0 });

export const useQuoteActivity = (orgSlug: string, quoteId: string | undefined, version: number | null | undefined) =>
  useRead<QuoteActivity>("getQuotesByQuoteIdVersionsByVersionActivity", { params: { orgSlug, quoteId: quoteId ?? "", version: String(version ?? 0) } }, { enabled: !!quoteId && !!version, retry: false });

export const useQuoteSettings = (orgSlug: string) => useRead<QuoteSettingsView>("getQuoteSettings", { params: { orgSlug } }, { retry: false });

export const useCatalogue = (orgSlug: string, enabled = true) => useRead<Page<CatalogueItemView>>("getCatalogue", { params: { orgSlug }, query: { pageSize: "100" } }, { enabled });

export const useApprovals = (orgSlug: string) => useRead<ApprovalPage>("getApprovals", { params: { orgSlug }, query: { pageSize: "100" } });

export const useApprovalRules = (orgSlug: string) => useRead<ApprovalRulesView>("getApprovalRules", { params: { orgSlug } }, { retry: false });

export const usePipelines = (orgSlug: string, enabled = true) => useRead<PipelineList>("getPipelines", { params: { orgSlug } }, { enabled, retry: false });

/* Writes ------------------------------------------------------------------------------------------------------------------------- */

/** `useApiMutation` whose input is typed loosely (the contract has no body type for several of these routes) and whose result is `T`. */
function useWrite<T, K extends OperationId = OperationId>(id: K, invalidate: string[], onSuccess?: (data: T) => void, onError?: (error: unknown) => void) {
  const m = useApiMutation(id, { invalidate: invalidate.map((k) => [k]), onSuccess: onSuccess as ((d: Operations[K]["response"]) => void) | undefined, onError });
  return {
    mutate: (args: unknown) => m.mutate(args as CallArgs<K>),
    mutateAsync: (args: unknown) => m.mutateAsync(args as CallArgs<K>) as unknown as Promise<T>,
    isPending: m.isPending,
  };
}

const QUOTE_READS = ["getQuotes", "getDealsByDealIdQuote", "getQuotesByQuoteId", "getQuotesByQuoteIdVersionsByVersion", "getQuotesByQuoteIdVersionsByVersionPreview", "getQuotesByQuoteIdVersionsByVersionActivity", "getApprovals", "getDeals", "getDeal"];

export const useCreateQuote = () => useWrite<{ quote: QuoteView; version: QuoteVersionView }>("postDealsByDealIdQuote", QUOTE_READS);
export const useSaveVersion = () => useWrite<QuoteVersionView>("putQuotesByQuoteIdVersionsByVersion", QUOTE_READS);
export const useNewVersion = () => useWrite<QuoteVersionView>("postQuotesByQuoteIdVersions", QUOTE_READS);
export const useSendQuote = () => useWrite<unknown>("postQuotesByQuoteIdVersionsByVersionSend", QUOTE_READS);
export const useRequestQuoteApproval = () => useWrite<ApprovalItem>("postQuotesByQuoteIdVersionsByVersionRequestApproval", QUOTE_READS);
export const useRecordResponse = () => useWrite<QuoteVersionView>("postQuotesByQuoteIdVersionsByVersionResponse", QUOTE_READS);
export const useApplyToDeal = () => useWrite<unknown>("postQuotesByQuoteIdVersionsByVersionApplyToDeal", QUOTE_READS);
export const useDecideApproval = () => useWrite<ApprovalItem>("postApprovalsByApprovalIdDecision", ["getApprovals", "getApprovalsByApprovalId", ...QUOTE_READS]);
export const useCancelApproval = () => useWrite<ApprovalItem>("postApprovalsByApprovalIdCancel", ["getApprovals", ...QUOTE_READS]);
export const useCreateCatalogueItem = () => useWrite<CatalogueItemView>("postCatalogue", ["getCatalogue"]);
export const useUpdateCatalogueItem = () => useWrite<CatalogueItemView>("patchCatalogueByItemId", ["getCatalogue", "getCatalogueByItemId"]);
export const useSaveApprovalRules = () => useWrite<ApprovalRulesView>("patchApprovalRules", ["getApprovalRules"]);
export const useCreatePipeline = () => useWrite<PipelineView>("postPipelines", ["getPipelines", "getReferenceData", "getDealsBoard"]);
export const useSaveStageRules = () => useWrite<{ stageId: string; rules: StageRuleView[]; impact: string }>("putPipelinesByPipelineIdStagesByStageIdRules", ["getPipelines"]);

/* Helpers ------------------------------------------------------------------------------------------------------------------------ */

export const kes = (n: number | null | undefined, currency = "KES"): string => (n === null || n === undefined ? "Hidden" : `${currency} ${Math.round(n).toLocaleString("en-KE")}`);

export const dateLabel = (iso: string): string => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
export const whenLabel = (iso: string): string => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The sentence a person reads when the API refused a write: its own message for a validation or conflict, the copy deck's otherwise. */
export { describeError } from "../../errors";

/**
 * A running estimate of the totals while a draft is being edited, from the prices the API already showed this person (lines on the version, list
 * prices of catalogue items they may read). Returns null when any needed price is hidden, so a masked figure is never worked back from anything.
 */
export function estimateTotals(lines: readonly { quantity: number; unitPrice: number | null }[], discountPercent: number): { subtotal: number; discount: number; total: number } | null {
  let subtotal = 0;
  for (const l of lines) {
    if (l.unitPrice === null) return null;
    subtotal += Math.round(l.unitPrice * l.quantity * 100) / 100;
  }
  const discount = Math.round(subtotal * discountPercent) / 100;
  return { subtotal, discount, total: Math.round((subtotal - discount) * 100) / 100 };
}

/** One history line per step a version went through, newest last. The API keeps the timestamps; the wording is here. */
export function historyOf(versions: readonly QuoteVersionSummary[]): { key: string; v: number; at: string; note: string }[] {
  const out: { key: string; v: number; at: string; note: string }[] = [];
  for (const s of versions) {
    out.push({ key: `${s.version}-c`, v: s.version, at: s.createdAt, note: s.version === 1 ? "Draft created" : `New version from v${s.version - 1}` });
    if (s.submittedAt) out.push({ key: `${s.version}-s`, v: s.version, at: s.submittedAt, note: `${s.discountPercent}% discount · sent for approval` });
    if (s.approvedAt) out.push({ key: `${s.version}-a`, v: s.version, at: s.approvedAt, note: "Discount approved" });
    else if (s.status === "REJECTED") out.push({ key: `${s.version}-r`, v: s.version, at: s.submittedAt ?? s.createdAt, note: `Not approved${s.decisionReason ? `: ${s.decisionReason}` : ""}` });
    if (s.sentAt) out.push({ key: `${s.version}-t`, v: s.version, at: s.sentAt, note: "Sent to the client with a secure link" });
    if (s.respondedAt) out.push({ key: `${s.version}-x`, v: s.version, at: s.respondedAt, note: s.status === "ACCEPTED" ? "Accepted by the client" : "Declined by the client" });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}
