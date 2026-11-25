/**
 * UC-F7 (architecture doc 18.5): the money adds up, and a move or restore changed none of it. Read-only; prints counts, sums and hashes, never a row.
 *
 * Per organisation and currency: invoices (active and void), payments (active and reversed), outstanding, quote totals and deal values by outcome.
 * Every row of every money table (invoices, payment_records, quotes, quote_versions, quote_lines, deals, recurring_services) goes into a hash, so money
 * is compared in full, not by sample. Internal checks: no negative amount, no payment without an invoice, no overpayment unless allowed, PAID invoices
 * have nothing outstanding, quote subtotals equal their lines.
 *
 *   # on the source, before the move:
 *   npm run verify:financials -- --out money-before.json
 *   # on the target, after:
 *   VERIFY_DATABASE_URL=<target owner login> npm run verify:financials -- --compare money-before.json
 *
 * Totals are compared as exact decimal text, so "to the cent" means identical. Exit 0 only when all checks pass (and, with --compare, all values equal).
 */
import { bypassesRls, gatherFinancials, readOnly } from "./lib/dataVerifyDb";
import { evaluateFinancials, flattenFinancials, formatChecks } from "./lib/dataVerify";
import { arg, finish, readFingerprint, withOwner, writeFingerprint } from "./lib/verifyCli";

finish(() =>
  withOwner(async (client) =>
    readOnly(client, async () => {
      const snapshot = await gatherFinancials(client);
      const out = arg("--out");
      if (out) writeFingerprint(out, "financial", flattenFinancials(snapshot));
      const report = evaluateFinancials(snapshot, await bypassesRls(client), readFingerprint(arg("--compare")));
      return { report, text: formatChecks("Financial totals", report, `${Object.keys(snapshot.groups).length} organisation and currency groups`) };
    }),
  ),
);
