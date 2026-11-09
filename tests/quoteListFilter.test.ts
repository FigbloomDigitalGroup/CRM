import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/auth/errors";
import { createQuote, listQuotesPage } from "../src/services/quoteService";
import { commercialWorld, dealOwnedBy } from "./commercialFixtures";

/**
 * The quotes list takes `dealId` as one deal or several separated by commas (the Quotes screen asks for the quotes of the deals on its page
 * in one request). Whatever is asked for is narrowed to the deals the caller may open: a deal that is not theirs, or not in their
 * organisation, answers an empty list, never another person's quote.
 */
describe("the quotes list's dealId filter", () => {
  async function world() {
    const w = await commercialWorld();
    const second = await dealOwnedBy(w.sales, w.company.id);
    const theirs = await dealOwnedBy(w.salesTwo, w.company.id);
    await createQuote(w.sales, w.deal.id, {});
    await createQuote(w.sales, second.id, {});
    await createQuote(w.salesTwo, theirs.id, {});
    return { ...w, second, theirs };
  }

  it("a salesperson asking for one of their deals gets that deal's quote only, not all their quotes", async () => {
    const w = await world();
    const all = await listQuotesPage(w.sales);
    expect(all.total).toBe(2);
    const one = await listQuotesPage(w.sales, { dealId: w.deal.id });
    expect(one.items.map((q) => q.dealId)).toEqual([w.deal.id]);
    expect(one.total).toBe(1);
    // The rows are the same rows, masking included, as in the unfiltered list.
    expect(one.items[0]).toEqual(all.items.find((q) => q.dealId === w.deal.id));
  });

  it("a deal that belongs to someone else answers an empty list, for the owner's colleague and for no one else's", async () => {
    const w = await world();
    const none = await listQuotesPage(w.sales, { dealId: w.theirs.id });
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
    // The same ask from the owner returns it.
    expect((await listQuotesPage(w.salesTwo, { dealId: w.theirs.id })).items.map((q) => q.dealId)).toEqual([w.theirs.id]);
  });

  it("several deals at once: only the ones the caller may open come back", async () => {
    const w = await world();
    const page = await listQuotesPage(w.sales, { dealId: [w.deal.id, w.second.id, w.theirs.id].join(",") });
    expect(page.items.map((q) => q.dealId).sort()).toEqual([w.deal.id, w.second.id].sort());
    expect(page.total).toBe(2);
  });

  it("Management is unaffected: any deal, one or several, and still the whole list with no filter", async () => {
    const w = await world();
    expect((await listQuotesPage(w.management)).total).toBe(3);
    expect((await listQuotesPage(w.management, { dealId: w.theirs.id })).items.map((q) => q.dealId)).toEqual([w.theirs.id]);
    expect((await listQuotesPage(w.management, { dealId: `${w.deal.id}, ${w.theirs.id}` })).total).toBe(2);
  });

  it("a deal from another organisation answers an empty list, even for Management", async () => {
    const w = await world();
    const other = await world();
    expect((await listQuotesPage(w.management, { dealId: other.deal.id })).items).toEqual([]);
    expect((await listQuotesPage(w.sales, { dealId: other.deal.id })).items).toEqual([]);
    expect((await listQuotesPage(w.management, { dealId: `${w.deal.id},${other.deal.id}` })).items.map((q) => q.dealId)).toEqual([w.deal.id]);
  });

  it("an unknown id or an empty filter is not an error, and an over-long list is refused with a reason", async () => {
    const w = await world();
    expect((await listQuotesPage(w.sales, { dealId: "00000000-0000-0000-0000-000000000000" })).items).toEqual([]);
    expect((await listQuotesPage(w.sales, { dealId: " , " })).total).toBe(2);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`).join(",");
    await expect(listQuotesPage(w.management, { dealId: many })).rejects.toBeInstanceOf(ValidationError);
  });
});
