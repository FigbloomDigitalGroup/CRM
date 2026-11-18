/**
 * Normalisation and fuzzy matching for duplicate detection (FIG-1033, B2.04).
 * Pure functions, no database. The SQL prefilters in
 * `src/repositories/duplicates.ts` use the same normal forms, so a match found
 * in the database is a match here and the other way round.
 */

/** Digits only. */
function digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * A phone number in one comparable form. Kenyan numbers written as
 * `0712 345 678`, `+254 712 345 678`, `254712345678`, `712345678`,
 * `(0712) 345-678` or `00254712345678` all become `254712345678`. A number with
 * another country code keeps it. Too short to be a phone number gives null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = digits(raw);
  if (d.startsWith("00")) d = d.slice(2); // international prefix
  if (d.length < 7) return null;
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`; // 0712..., 0112...
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) return `254${d}`; // 712...
  return d;
}

/** The last nine digits: what the database index compares, so formatting and country code never matter. */
export function phoneTail(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  return n ? n.slice(-9) : null;
}

/** Lower case, and plus-addressing removed: `Jane+sales@Acme.com` and `jane@acme.com` are one address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at).replace(/\+.*$/, "");
  if (!local) return null;
  return `${local}@${trimmed.slice(at + 1)}`;
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
]);

const SECOND_LEVEL = new Set(["co", "or", "ac", "go", "ne", "sc", "com", "org", "net", "edu", "gov"]);

/** `https://www.shop.sarova.co.ke/about` -> `sarova.co.ke`. Null when there is no usable host. */
export function registrableDomain(rawHostOrUrl: string | null | undefined): string | null {
  if (!rawHostOrUrl) return null;
  let host = rawHostOrUrl.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^@/]*@/, "");
  host = host.split(/[/:?#]/)[0] ?? "";
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host || !host.includes(".") || /\s/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const last = labels[labels.length - 1]!;
  const prev = labels[labels.length - 2]!;
  // sarova.co.ke, bbc.co.uk, example.com.au
  if (last.length === 2 && SECOND_LEVEL.has(prev)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** A company-looking domain from an email address, or null for gmail.com and the like (shared by millions). */
export function corporateEmailDomain(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const domain = registrableDomain(normalized.slice(normalized.lastIndexOf("@") + 1));
  return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : null;
}

/** The domain a record points at: its website first, else a corporate email domain. */
export function recordDomain(website: string | null | undefined, email: string | null | undefined): string | null {
  return registrableDomain(website) ?? corporateEmailDomain(email);
}

const LEGAL_WORDS = new Set([
  "ltd",
  "limited",
  "plc",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "co",
  "company",
  "corp",
  "corporation",
  "group",
  "holdings",
  "kenya",
  "ke",
  "the",
  "and",
  "of",
]);

/** Lower case words without punctuation or legal suffixes: "Sarova Hotels Ltd." and "SAROVA hotels" compare equal. */
export function companyNameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const kept = words.filter((w) => !LEGAL_WORDS.has(w));
  return kept.length > 0 ? kept : words;
}

export function normalizeCompanyName(name: string | null | undefined): string {
  return companyNameTokens(name).join(" ");
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) set.add(padded.slice(i, i + 3));
  return set;
}

/** Dice coefficient over trigrams, 0 to 1. Tolerates typos and word order better than edit distance on whole strings. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sortedA = [...companyNameTokens(a)].sort().join(" ");
  const sortedB = [...companyNameTokens(b)].sort().join(" ");
  if (sortedA === sortedB) return 0.97; // same words, different order
  const ta = trigrams(na);
  const tb = trigrams(nb);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return (2 * shared) / (ta.size + tb.size);
}

/** A person's name as one comparable string. */
export function normalizePersonName(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ""} ${last ?? ""}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export type MatchConfidence = "high" | "medium" | "low";

export interface MatchReason {
  type: "EMAIL" | "PHONE" | "DOMAIN" | "NAME" | "SIMILAR_NAME" | "COMPANY";
  /** Human wording for the warning. */
  detail: string;
  /** How much this reason alone says "same record", 0 to 1. */
  weight: number;
}

/** Several independent reasons strengthen each other: 1 - product of (1 - weight). */
export function combineReasons(reasons: MatchReason[]): { score: number; confidence: MatchConfidence } {
  const score = 1 - reasons.reduce((miss, r) => miss * (1 - r.weight), 1);
  const confidence: MatchConfidence = score >= 0.85 ? "high" : score >= 0.6 ? "medium" : "low";
  return { score: Math.round(score * 1000) / 1000, confidence };
}

/** Below this, two company names are not offered as a possible duplicate. */
export const SIMILAR_NAME_THRESHOLD = 0.78;
