import { z } from "zod";

/** Request shapes shared by the quote routes (FIG-1143, B6.11). */
export const Money = z.union([z.number(), z.string()]);

export const QuoteLineSchema = z.strictObject({
  /** An existing line of the draft: keeps its frozen price and cost. */
  lineId: z.string().optional(),
  catalogueItemId: z.string().optional(),
  description: z.string().optional(),
  unit: z.string().optional(),
  quantity: Money,
  /** Custom lines only; a catalogue line takes the catalogue price. */
  unitPrice: Money.optional(),
  taxable: z.boolean().optional(),
});

export const QuoteContentSchema = z.strictObject({
  lines: z.array(QuoteLineSchema).optional(),
  discountPercent: Money.optional(),
  validUntil: z.string().optional(),
  terms: z.string().nullable().optional(),
});

export function parseVersionParam(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 0;
}
