/** Demo data and wording for the public signing page (FIG-1193). Replace `demoSigningFor` with the real signing-link lookup (B7.04) when it exists. */

export type Lang = "en" | "sw";

export interface SigningQuote {
  token: string;
  no: string;
  company: string;
  contact: string;
  validUntil: string;
  lines: { name: string; qty: number; unit: number }[];
  discountPct: number;
  terms: string;
  state: "unsigned" | "signed" | "deposit";
  signer?: string;
  signedAt?: string;
  /** The deposit request is shown only when the open decision (B7.05) is approved; a quote without one never mentions it. */
  depositAmount?: number;
}

const LINES = [
  { name: "CCTV camera (4MP dome), installed", qty: 12, unit: 18500 },
  { name: "NVR 16-channel recorder", qty: 1, unit: 65000 },
  { name: "Starlink kit and installation", qty: 1, unit: 95000 },
];

const BASE = { no: "Q-2026-032", company: "Mwangaza Schools", contact: "Grace Wanjiru", validUntil: "2026-11-28", lines: LINES, discountPct: 8, terms: "50% deposit, balance on delivery. Prices include 16% VAT." };

export function totalOf(lines: { qty: number; unit: number }[], discountPct: number): number {
  const sub = lines.reduce((a, l) => a + l.qty * l.unit, 0);
  return sub - Math.round((sub * discountPct) / 100);
}

export function demoSigningFor(token: string): SigningQuote | null {
  if (token === "demo-unsigned") return { ...BASE, token, state: "unsigned" };
  if (token === "demo-signed") return { ...BASE, token, state: "signed", signer: "Grace Wanjiru", signedAt: "2026-10-29T09:12:00+03:00" };
  if (token === "demo-deposit") return { ...BASE, token, state: "deposit", signer: "Grace Wanjiru", signedAt: "2026-10-29T09:12:00+03:00", depositAmount: Math.round(totalOf(BASE.lines, BASE.discountPct) / 2) };
  return null;
}

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** A name the person typed counts as a signature only when it has at least two letters; and they must have agreed. */
export function canSign(name: string, agreed: boolean): boolean {
  return agreed && name.trim().replace(/[^\p{L}]/gu, "").length >= 2;
}

export const TEXT = {
  en: {
    title: (no: string) => `Quote ${no}`,
    for: (c: string) => `Prepared for ${c}`,
    valid: (d: string) => `Valid until ${d}`,
    item: "Item",
    qty: "Qty",
    amount: "Amount",
    subtotal: "Subtotal",
    discount: (p: number) => `Discount (${p}%)`,
    total: "Total (incl. VAT)",
    name: "Your full name",
    agree: "I agree to the scope, prices and terms in this quote.",
    sign: "Sign and accept",
    needName: "Type your full name and tick the box to sign.",
    signedTitle: "Signed. Thank you.",
    signedBy: (n: string, t: string) => `Signed by ${n} on ${t}`,
    audit: "Your signature, the time and your device address are kept as a record.",
    depositTitle: "Deposit requested",
    depositBody: (a: string) => `A deposit of ${a} was requested. You will get an M-Pesa or bank prompt from our payment provider. Figbloom only records the status.`,
    invalidTitle: "This link is not valid",
    invalidBody: "It may have expired or been replaced by a newer version. Please ask your contact at FigBloom for a new link.",
    lang: "Language",
  },
  sw: {
    title: (no: string) => `Makadirio ya bei ${no}`,
    for: (c: string) => `Imeandaliwa kwa ${c}`,
    valid: (d: string) => `Inatumika hadi ${d}`,
    item: "Huduma",
    qty: "Idadi",
    amount: "Kiasi",
    subtotal: "Jumla ndogo",
    discount: (p: number) => `Punguzo (${p}%)`,
    total: "Jumla (pamoja na VAT)",
    name: "Jina lako kamili",
    agree: "Nakubali huduma, bei na masharti yaliyomo kwenye makadirio haya.",
    sign: "Saini na ukubali",
    needName: "Andika jina lako kamili na uweke tiki ili usaini.",
    signedTitle: "Imesainiwa. Asante.",
    signedBy: (n: string, t: string) => `Imesainiwa na ${n} tarehe ${t}`,
    audit: "Sahihi yako, muda na anwani ya kifaa chako vinahifadhiwa kama kumbukumbu.",
    depositTitle: "Ombi la amana limetumwa",
    depositBody: (a: string) => `Amana ya ${a} imeombwa. Utapokea ujumbe wa M-Pesa au benki kutoka kwa mtoa huduma wa malipo. Figbloom hurekodi hali tu.`,
    invalidTitle: "Kiungo hiki si halali",
    invalidBody: "Huenda kimeisha muda au kimebadilishwa na toleo jipya. Tafadhali mwombe mwakilishi wako wa FigBloom kiungo kipya.",
    lang: "Lugha",
  },
} satisfies Record<Lang, unknown>;
