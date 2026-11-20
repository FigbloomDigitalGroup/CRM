/**
 * UC-F7 (architecture doc 18.5): no duplicate natural keys, every index valid and ready (a unique index that is not valid does not stop duplicates),
 * and, once the attribution ledger exists (UC-C8), no duplicate attribution rows. Read-only; prints counts of repeated key values, never the values.
 *
 *   npm run verify:duplicates
 *
 * The natural keys checked are listed in NATURAL_KEYS in scripts/lib/dataVerifyDb.ts. A table of a later release that is not there yet is skipped, not passed.
 */
import { bypassesRls, gatherDuplicates, readOnly } from "./lib/dataVerifyDb";
import { evaluateDuplicates, formatChecks } from "./lib/dataVerify";
import { finish, withOwner } from "./lib/verifyCli";

finish(() =>
  withOwner(async (client) =>
    readOnly(client, async () => {
      const d = await gatherDuplicates(client);
      const report = evaluateDuplicates(d.findings, d.invalidIndexes, d.attributionTables, await bypassesRls(client));
      return { report, text: formatChecks("Duplicates", report) };
    }),
  ),
);
