import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { maskServiceValue } from "../auth/masking";
import { ValidationError } from "../auth/errors";
import { buildPage, resolvePaging, type Page, type PageRequest } from "../lib/pagination";
import { fromCents, startOfDay, toCents } from "../lib/payments";
import { renewalStanding, type RenewalState } from "../lib/renewals";
import { listCustomers, listHoldings, listLiveRecurring, listSentProposals, listServiceNames } from "../repositories/retention";
import { loadDormancyDays } from "./customerReportService";
import { loadReminderSettings } from "./reminderService";
import { loadRenewalSettings } from "./renewalSettings";

/**
 * The Renewals and retention page (FIG-1052, B3.06, design E2): what needs attention to keep customers.
 *
 * Five lists. A customer appears in exactly one of them, the first that applies, with the reason stated; anything else
 * that also applies is listed on the row as `alsoMatches`, so nothing is hidden and nothing is counted twice:
 *
 *   1 LAPSED                renewal date past the grace window
 *   2 DUE_30                renewal due within 30 days (or past the date but still inside the grace window)
 *   3 UNANSWERED_PROPOSALS  a proposal sent more than the follow-up time ago with no answer, on an open deal
 *   4 GOING_QUIET           no activity for half the dormancy time or more, but not yet dormant
 *   5 CROSS_SELL            a service that at least two similar customers (same industry) use and this one does not
 *
 * Management sees every customer; Sales sees the customers it owns. Counts are the lists' own lengths.
 */

export const RETENTION_LISTS = ["LAPSED", "DUE_30", "UNANSWERED_PROPOSALS", "GOING_QUIET", "CROSS_SELL"] as const;
export type RetentionList = (typeof RETENTION_LISTS)[number];

export const DUE_HORIZON_DAYS = 30;
export const MIN_SIMILAR_CUSTOMERS = 2;
const MAX_SUGGESTIONS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionRow {
  companyId: string;
  companyName: string;
  list: RetentionList;
  /** Why this customer is here, in a sentence. */
  reason: string;
  ownerMembershipId: string | null;
  lifecycleKey: string | null;
  suggestedAction: { type: "RENEW_SERVICE" | "FOLLOW_UP_PROPOSAL" | "LOG_CONTACT" | "OFFER_SERVICE" | "OPEN_COMPANY"; label: string; path: string };
  service: null | { id: string; name: string; renewsOn: Date; daysToRenewal: number; state: RenewalState; value: string | null; valueMasked: boolean; currency: string };
  proposal: null | { id: string; number: string; daysSinceSent: number; dealId: string };
  quietDays: number | null;
  suggestions: { serviceId: string; serviceName: string; similarCustomers: number }[];
  alsoMatches: { list: RetentionList; reason: string }[];
}

interface Candidate {
  companyId: string;
  list: RetentionList;
  reason: string;
  ownerMembershipId: string | null;
  /** Order within the list: smaller first. */
  rank: number;
  action: RetentionRow["suggestedAction"];
  service?: RetentionRow["service"];
  proposal?: RetentionRow["proposal"];
  quietDays?: number;
  suggestions?: RetentionRow["suggestions"];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function getRenewalsAndRetention(
  ctx: AuthContext,
  options: { list?: string } & PageRequest = {},
  now = new Date(),
) {
  requirePermission(ctx, "company_services.manage");
  const only = options.list;
  if (only !== undefined && !(RETENTION_LISTS as readonly string[]).includes(only)) {
    throw new ValidationError(`Unknown list "${only}".`, [{ path: "list", message: `Use one of ${RETENTION_LISTS.join(", ")}.` }]);
  }
  const organizationId = ctx.organizationId;
  const today = startOfDay(now);
  const [customers, recurring, holdings, serviceNames, dormancyDays, reminderSettings, renewalSettings] = await Promise.all([
    listCustomers(organizationId),
    listLiveRecurring(organizationId),
    listHoldings(organizationId),
    listServiceNames(organizationId),
    loadDormancyDays(organizationId),
    loadReminderSettings(organizationId),
    loadRenewalSettings(organizationId),
  ]);
  const proposals = await listSentProposals(organizationId, new Date(now.getTime() - reminderSettings.proposalFollowUp.days * DAY_MS));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const candidates: Candidate[] = [];

  // 1 and 2: recurring services that have lapsed or are due.
  for (const r of recurring) {
    const company = byId.get(r.companyId);
    if (!company) continue;
    const standing = renewalStanding({ startsOn: r.startsOn, renewsOn: r.renewsOn, cancelledAt: r.cancelledAt, stateOverride: r.stateOverride }, today, renewalSettings);
    const masked = maskServiceValue(ctx, { ownerMembershipId: r.ownerMembershipId, value: r.value ? fromCents(toCents(r.value)) : null });
    const service: NonNullable<RetentionRow["service"]> = {
      id: r.id,
      name: r.service.name,
      renewsOn: r.renewsOn,
      daysToRenewal: standing.daysToRenewal,
      state: standing.state,
      value: masked.value as string | null,
      valueMasked: masked.valueMasked,
      currency: r.currency,
    };
    const owner = r.ownerMembershipId ?? company.ownerMembershipId;
    const d = standing.daysToRenewal;
    const action = { type: "RENEW_SERVICE" as const, label: "Renew or confirm cancellation", path: `/recurring-services/${r.id}` };
    if (standing.state === "LAPSED") {
      candidates.push({ companyId: r.companyId, list: "LAPSED", reason: `${r.service.name} lapsed ${plural(-d, "day")} ago.`, ownerMembershipId: owner, rank: d, action, service });
    } else if (standing.state === "DUE_SOON" && d <= DUE_HORIZON_DAYS) {
      const reason = d < 0 ? `${r.service.name} was due ${plural(-d, "day")} ago and is inside the grace period.` : d === 0 ? `${r.service.name} renews today.` : `${r.service.name} renews in ${plural(d, "day")}.`;
      candidates.push({ companyId: r.companyId, list: "DUE_30", reason, ownerMembershipId: owner, rank: d, action, service });
    }
  }

  // 3: proposals with no answer.
  for (const p of proposals) {
    const company = byId.get(p.deal.companyId);
    if (!company) continue;
    const days = Math.floor((now.getTime() - (p.sentAt ?? p.updatedAt).getTime()) / DAY_MS);
    candidates.push({
      companyId: company.id,
      list: "UNANSWERED_PROPOSALS",
      reason: `Proposal ${p.proposalNumber} was sent ${plural(days, "day")} ago and has had no answer.`,
      ownerMembershipId: p.ownerMembershipId ?? p.deal.ownerMembershipId ?? company.ownerMembershipId,
      rank: -days,
      action: { type: "FOLLOW_UP_PROPOSAL", label: "Follow up on the proposal", path: `/deals/${p.dealId}` },
      proposal: { id: p.id, number: p.proposalNumber, daysSinceSent: days, dealId: p.dealId },
    });
  }

  // 4: going quiet.
  const quietFrom = Math.floor(dormancyDays / 2);
  for (const c of customers) {
    if (c.lifecycleKey === "DORMANT_CUSTOMER" || c.lifecycleKey === "ONBOARDING") continue;
    const quiet = Math.floor((now.getTime() - (c.lastActivity ?? c.createdAt).getTime()) / DAY_MS);
    if (quiet >= quietFrom && quiet <= dormancyDays) {
      candidates.push({
        companyId: c.id,
        list: "GOING_QUIET",
        reason: `No contact for ${plural(quiet, "day")}; the customer becomes dormant after ${plural(dormancyDays, "day")}.`,
        ownerMembershipId: c.ownerMembershipId,
        rank: -quiet,
        action: { type: "LOG_CONTACT", label: "Get in touch", path: `/companies/${c.id}` },
        quietDays: quiet,
      });
    }
  }

  // 5: cross-sell, by what similar customers (same industry) use.
  const heldBy = new Map<string, Set<string>>();
  for (const h of holdings) {
    if (!heldBy.has(h.companyId)) heldBy.set(h.companyId, new Set());
    heldBy.get(h.companyId)!.add(h.serviceId);
  }
  const industryOf = (c: { industry: string | null }) => c.industry?.trim().toLowerCase() || null;
  const peersByIndustry = new Map<string, string[]>();
  for (const c of customers) {
    const ind = industryOf(c);
    if (ind) peersByIndustry.set(ind, [...(peersByIndustry.get(ind) ?? []), c.id]);
  }
  const nameOfService = new Map(serviceNames.map((s) => [s.id, s.name]));
  for (const c of customers) {
    const ind = industryOf(c);
    if (!ind) continue;
    const mine = heldBy.get(c.id) ?? new Set<string>();
    const tally = new Map<string, number>();
    for (const peerId of peersByIndustry.get(ind) ?? []) {
      if (peerId === c.id) continue;
      for (const s of heldBy.get(peerId) ?? []) if (!mine.has(s)) tally.set(s, (tally.get(s) ?? 0) + 1);
    }
    const suggestions = [...tally.entries()]
      .filter(([s, n]) => n >= MIN_SIMILAR_CUSTOMERS && nameOfService.has(s))
      .map(([serviceId, similarCustomers]) => ({ serviceId, serviceName: nameOfService.get(serviceId)!, similarCustomers }))
      .sort((a, b) => b.similarCustomers - a.similarCustomers || a.serviceName.localeCompare(b.serviceName))
      .slice(0, MAX_SUGGESTIONS);
    if (suggestions.length === 0) continue;
    const top = suggestions[0]!;
    candidates.push({
      companyId: c.id,
      list: "CROSS_SELL",
      reason: `${plural(top.similarCustomers, "similar customer")} in ${c.industry!.trim()} use ${top.serviceName}.`,
      ownerMembershipId: c.ownerMembershipId,
      rank: -top.similarCustomers,
      action: { type: "OFFER_SERVICE", label: `Offer ${top.serviceName}`, path: `/companies/${c.id}` },
      suggestions,
    });
  }

  // One primary list per customer: the first that applies; the others are kept as `alsoMatches`.
  const grouped = new Map<string, Candidate[]>();
  for (const cand of candidates) grouped.set(cand.companyId, [...(grouped.get(cand.companyId) ?? []), cand]);
  const rows: RetentionRow[] = [];
  /** Order inside a list: smaller first (the most overdue, the longest waiting). */
  const rankOf = new Map<string, number>();
  for (const [companyId, list] of grouped) {
    list.sort((a, b) => RETENTION_LISTS.indexOf(a.list) - RETENTION_LISTS.indexOf(b.list) || a.rank - b.rank);
    const [primary, ...rest] = list as [Candidate, ...Candidate[]];
    const company = byId.get(companyId)!;
    const seen = new Set<RetentionList>([primary.list]);
    const alsoMatches = rest.filter((c) => !seen.has(c.list) && seen.add(c.list)).map((c) => ({ list: c.list, reason: c.reason }));
    rows.push({
      companyId,
      companyName: company.name,
      list: primary.list,
      reason: primary.reason,
      ownerMembershipId: primary.ownerMembershipId,
      lifecycleKey: company.lifecycleKey,
      suggestedAction: primary.action,
      service: primary.service ?? null,
      proposal: primary.proposal ?? null,
      quietDays: primary.quietDays ?? null,
      suggestions: primary.suggestions ?? [],
      alsoMatches,
    });
    rankOf.set(companyId, primary.rank);
  }

  const organisationWide = hasPermission(ctx, "reporting.view.all");
  const visible = organisationWide ? rows : rows.filter((r) => r.ownerMembershipId === ctx.membershipId);
  const sorted = (key: RetentionList) =>
    visible
      .filter((r) => r.list === key)
      .sort((a, b) => rankOf.get(a.companyId)! - rankOf.get(b.companyId)! || a.companyName.localeCompare(b.companyName) || a.companyId.localeCompare(b.companyId));
  const all = Object.fromEntries(RETENTION_LISTS.map((k) => [k, sorted(k)])) as Record<RetentionList, RetentionRow[]>;
  const counts = Object.fromEntries(RETENTION_LISTS.map((k) => [k, all[k].length])) as Record<RetentionList, number>;
  const paging = resolvePaging(options);
  const lists = Object.fromEntries(
    (only ? [only as RetentionList] : [...RETENTION_LISTS]).map((k) => [k, buildPage(all[k].slice(paging.skip, paging.skip + paging.take), all[k].length, paging)]),
  ) as Partial<Record<RetentionList, Page<RetentionRow>>>;
  return {
    scope: organisationWide ? ("organisation" as const) : ("own" as const),
    counts,
    total: RETENTION_LISTS.reduce((sum, k) => sum + counts[k], 0),
    lists,
    thresholds: { dormancyDays, goingQuietFromDays: quietFrom, proposalFollowUpDays: reminderSettings.proposalFollowUp.days, dueWithinDays: DUE_HORIZON_DAYS, graceDays: renewalSettings.graceDays },
  };
}
