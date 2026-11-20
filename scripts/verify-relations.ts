/**
 * UC-F7 (architecture doc 18.5): every foreign key resolves, including the hand-written composite ones (organisation plus id), and no table holds an
 * orphan row. Read-only; prints key names and counts, never a row.
 *
 *   npm run verify:relations
 *   VERIFY_DATABASE_URL=<restored copy, owner login> npm run verify:relations
 *
 * Exit 0 when every key is validated and there are zero orphans, 1 otherwise.
 */
import { bypassesRls, gatherForeignKeys, readOnly } from "./lib/dataVerifyDb";
import { evaluateRelations, formatChecks } from "./lib/dataVerify";
import { finish, withOwner } from "./lib/verifyCli";

finish(() =>
  withOwner(async (client) =>
    readOnly(client, async () => {
      const report = evaluateRelations(await gatherForeignKeys(client), await bypassesRls(client));
      return { report, text: formatChecks("Foreign keys and orphans", report) };
    }),
  ),
);
