import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import {
  combineReasons,
  companyNameTokens,
  corporateEmailDomain,
  nameSimilarity,
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  phoneTail,
  recordDomain,
  registrableDomain,
  SIMILAR_NAME_THRESHOLD,
  type MatchConfidence,
  type MatchReason,
} from "../lib/matching";
import {
  companyCandidateIds,
  contactCandidateIds,
  contactIdsByName,
  getCompaniesByIds,
  getContactsByIds,
  openLeadsFor,
} from "../repositories/duplicates";

/**
 * The one duplicate detector (FIG-1033, B2.04), used by create, import, quick
 * capture and the merge screen. It warns and never blocks: it returns
 * candidates with the reasons and a confidence band, and the caller decides.
 *
 * Matching: phone (Kenyan formats compared by their last nine digits), email
 * (case and plus-addressing ignored), company name (fuzzy), and website or
 * email domain. Scope: a caller sees only the candidates they may open; the
 * rest are counted in `hiddenCount`, never described.
 */

export type DuplicateEntity = "lead" | "contact" | "company";

export interface DuplicateQuery {
  /** What is being created or checked. A lead is checked through its contact and company. */
  entity: DuplicateEntity;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  /** Lead: the company it is for. */
  companyId?: string | null;
  /** Lead: the contact it is for. */
  contactId?: string | null;
  /** The record being edited or merged; never reported as its own duplicate. */
  excludeId?: string | null;
}

export interface DuplicateCandidate {
  entityType: DuplicateEntity;
  id: string;
  label: string;
  reasons: { type: MatchReason["type"]; detail: string }[];
  confidence: MatchConfidence;
  score: number;
}

export interface DuplicateResult {
  candidates: DuplicateCandidate[];
  /** Candidates the caller may not open: counted, not described. */
  hiddenCount: number;
}

const MAX_CANDIDATES = 8;

interface Scored {
  entityType: DuplicateEntity;
  id: string;
  label: string;
  reasons: MatchReason[];
  /** Whether the caller may open it. */
  visible: boolean;
}

function personLabel(first: string, last: string | null): string {
  return `${first} ${last ?? ""}`.trim();
}

function addReason(map: Map<string, Scored>, key: string, init: Omit<Scored, "reasons">, reason: MatchReason) {
  const existing = map.get(key);
  if (existing) {
    if (!existing.reasons.some((r) => r.type === reason.type)) existing.reasons.push(reason);
  } else {
    map.set(key, { ...init, reasons: [reason] });
  }
}

/** Leads are visible to Management-style roles organisation-wide, to others only when they own the lead (the shared pool is added by B2.02). */
function canOpenLead(ctx: AuthContext, lead: { ownerMembershipId: string | null }): boolean {
  if (hasPermission(ctx, "leads.view.all")) return true;
  return hasPermission(ctx, "leads.view.own") && lead.ownerMembershipId === ctx.membershipId;
}

export async function findDuplicates(ctx: AuthContext, query: DuplicateQuery): Promise<DuplicateResult> {
  const org = ctx.organizationId;
  const email = normalizeEmail(query.email);
  const tail = phoneTail(query.phone);
  const domain = recordDomain(query.website, query.email);
  const nameTokens = companyNameTokens(query.companyName);
  const exclude = query.excludeId ? [query.excludeId] : [];
  const canSeeCompanies = hasPermission(ctx, "companies.view");
  const canSeeContacts = hasPermission(ctx, "contacts.view");

  const scored = new Map<string, Scored>();

  // Contacts: shared phone or email, or the same person name at the same company.
  const wantContacts = query.entity !== "company" || email || tail;
  if (wantContacts) {
    const contactIds = new Set(await contactCandidateIds(org, { phoneTail: tail, email, excludeIds: exclude }));
    const personName = normalizePersonName(query.firstName, query.lastName);
    if (query.firstName && query.lastName && query.entity === "contact") {
      for (const id of await contactIdsByName(org, query.firstName, query.lastName, exclude)) contactIds.add(id);
    }
    const contacts = await getContactsByIds(org, [...contactIds]);
    for (const c of contacts) {
      const init = { entityType: "contact" as const, id: c.id, label: personLabel(c.firstName, c.lastName), visible: canSeeContacts };
      if (email && normalizeEmail(c.email) === email) {
        addReason(scored, `contact:${c.id}`, init, { type: "EMAIL", detail: `Same email (${c.email})`, weight: 0.95 });
      }
      if (tail && phoneTail(c.phone) === tail) {
        addReason(scored, `contact:${c.id}`, init, { type: "PHONE", detail: `Same phone number (${c.phone})`, weight: 0.9 });
      }
      if (
        personName &&
        query.entity === "contact" &&
        normalizePersonName(c.firstName, c.lastName) === personName &&
        (!query.companyId || c.companyId === query.companyId)
      ) {
        addReason(scored, `contact:${c.id}`, init, {
          type: "NAME",
          detail: `Same name${c.company ? ` at ${c.company.name}` : ""}`,
          weight: query.companyId ? 0.7 : 0.45,
        });
      }
    }
  }

  // Companies: shared phone, email or domain, or a similar name.
  const wantCompanies = query.entity === "company" || query.entity === "lead";
  if (wantCompanies || email || tail || domain) {
    const companyIds = await companyCandidateIds(org, { phoneTail: tail, email, domain, nameTokens, excludeIds: exclude });
    const companies = await getCompaniesByIds(org, companyIds);
    for (const co of companies) {
      const init = { entityType: "company" as const, id: co.id, label: co.name, visible: canSeeCompanies };
      if (email && normalizeEmail(co.email) === email) {
        addReason(scored, `company:${co.id}`, init, { type: "EMAIL", detail: `Same email (${co.email})`, weight: 0.95 });
      }
      if (tail && phoneTail(co.phone) === tail) {
        addReason(scored, `company:${co.id}`, init, { type: "PHONE", detail: `Same phone number (${co.phone})`, weight: 0.9 });
      }
      const coDomain = recordDomain(co.website, co.email);
      if (domain && coDomain === domain && (query.entity === "company" || query.website || corporateEmailDomain(query.email))) {
        addReason(scored, `company:${co.id}`, init, { type: "DOMAIN", detail: `Same website or email domain (${domain})`, weight: 0.55 });
      }
      if (query.companyName) {
        const sim = nameSimilarity(query.companyName, co.name);
        if (normalizeCompanyName(query.companyName) === normalizeCompanyName(co.name)) {
          addReason(scored, `company:${co.id}`, init, { type: "NAME", detail: `Same company name (${co.name})`, weight: 0.92 });
        } else if (sim >= SIMILAR_NAME_THRESHOLD) {
          addReason(scored, `company:${co.id}`, init, {
            type: "SIMILAR_NAME",
            detail: `Similar company name (${co.name})`,
            weight: Math.min(0.8, sim * 0.85),
          });
        }
      }
    }
  }

  // Leads: an open lead for the same company or contact that matched above, or that the new lead names directly.
  if (query.entity === "lead") {
    const companyIds = new Set<string>();
    const contactIds = new Set<string>();
    if (query.companyId) companyIds.add(query.companyId);
    if (query.contactId) contactIds.add(query.contactId);
    for (const s of scored.values()) {
      if (s.entityType === "company" && s.reasons.some((r) => r.weight >= 0.55)) companyIds.add(s.id);
      if (s.entityType === "contact" && s.reasons.some((r) => r.weight >= 0.9)) contactIds.add(s.id);
    }
    const leads = await openLeadsFor(org, { companyIds: [...companyIds], contactIds: [...contactIds] });
    for (const lead of leads) {
      if (lead.id === query.excludeId) continue;
      const label = lead.contact
        ? `Lead for ${personLabel(lead.contact.firstName, lead.contact.lastName)}${lead.company ? ` (${lead.company.name})` : ""}`
        : `Lead for ${lead.company?.name ?? "an unnamed company"}`;
      const init = { entityType: "lead" as const, id: lead.id, label, visible: canOpenLead(ctx, lead) };
      if (lead.contactId && contactIds.has(lead.contactId)) {
        addReason(scored, `lead:${lead.id}`, init, { type: "COMPANY", detail: "Open lead for the same contact", weight: 0.9 });
      } else if (lead.companyId && companyIds.has(lead.companyId)) {
        addReason(scored, `lead:${lead.id}`, init, { type: "COMPANY", detail: "Open lead for the same company", weight: 0.7 });
      }
    }
  }

  // A lead is a duplicate through its parents; do not also list the bare contact or company as its duplicate unless creating that type.
  const result: DuplicateCandidate[] = [];
  let hiddenCount = 0;
  const ranked = [...scored.values()]
    .map((s) => ({ s, ...combineReasons(s.reasons) }))
    .filter((x) => x.s.reasons.length > 0)
    .sort((a, b) => b.score - a.score);
  for (const { s, score, confidence } of ranked) {
    if (!s.visible) {
      hiddenCount += 1;
      continue;
    }
    if (result.length < MAX_CANDIDATES) {
      result.push({
        entityType: s.entityType,
        id: s.id,
        label: s.label,
        reasons: s.reasons.map((r) => ({ type: r.type, detail: r.detail })),
        confidence,
        score,
      });
    }
  }
  return { candidates: result, hiddenCount };
}

/** Normalised phone, for callers that store or compare it (import, quick capture). */
export const phoneForMatching = normalizePhone;
export { registrableDomain };

const CREATE_PERMISSION: Record<DuplicateEntity, string> = {
  lead: "leads.create",
  contact: "contacts.create",
  company: "companies.create",
};

/** The duplicate check as an endpoint: needs the permission to create that kind of record. */
export async function checkDuplicates(ctx: AuthContext, query: DuplicateQuery): Promise<DuplicateResult> {
  requirePermission(ctx, CREATE_PERMISSION[query.entity]);
  return findDuplicates(ctx, query);
}
