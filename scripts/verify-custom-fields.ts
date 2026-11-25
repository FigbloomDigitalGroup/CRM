/**
 * UC-F7 (architecture doc 18.5): custom-field values survive a move. Per definition: how many rows carry the key, and a hash of the values (in id order).
 * Also counts stored values whose key has no definition. Read-only; prints definition ids, entity and key names (configuration, not personal data), counts
 * and hashes, never a value.
 *
 *   npm run verify:custom-fields -- --out cf-before.json
 *   VERIFY_DATABASE_URL=<target owner login> npm run verify:custom-fields -- --compare cf-before.json
 */
import { bypassesRls, gatherCustomFields, readOnly } from "./lib/dataVerifyDb";
import { evaluateCustomFields, flattenCustomFields, formatChecks } from "./lib/dataVerify";
import { arg, finish, readFingerprint, withOwner, writeFingerprint } from "./lib/verifyCli";

finish(() =>
  withOwner(async (client) =>
    readOnly(client, async () => {
      const state = await gatherCustomFields(client);
      const out = arg("--out");
      if (out) writeFingerprint(out, "custom-field", flattenCustomFields(state));
      const report = evaluateCustomFields(state, await bypassesRls(client), readFingerprint(arg("--compare")));
      return { report, text: formatChecks("Custom fields", report, `${state.definitions} definitions`) };
    }),
  ),
);
