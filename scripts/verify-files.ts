/**
 * UC-F7 (architecture doc 18.5): every non-purged File row has its object, of the right size, with a matching checksum; and the objects nobody points at
 * are reported. Local storage driver only for now (the s3 driver is reported as not supported, not passed). Read-only; prints counts, never a name or key.
 *
 *   npm run verify:files
 *   npm run verify:files -- --root D:/restored/files --checksum all --fail-on-orphans
 *
 * --root <dir>        where the objects are (default STORAGE_LOCAL_DIR, else .data/files).
 * --checksum all|<n>  hash every object, or the n rows with the smallest md5(id) (default 200; the same rows on both sides of a move).
 *                     Use "all" for signed and legal documents.
 * --fail-on-orphans   an object with no row (or still present for a purged row) fails the run instead of being reported.
 */
import { join } from "node:path";
import { bypassesRls, gatherFileRows, inspectLocalFiles, readOnly } from "./lib/dataVerifyDb";
import { evaluateFiles, formatChecks, ownerCheck } from "./lib/dataVerify";
import { arg, finish, flag, withOwner } from "./lib/verifyCli";

finish(() =>
  withOwner(async (client) => {
    const driver = process.env.STORAGE_DRIVER ?? "local";
    const rows = await readOnly(client, () => gatherFileRows(client));
    const bypass = await bypassesRls(client);
    const root = arg("--root") ?? process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), ".data", "files");
    const sample = arg("--checksum") ?? "200";
    const checksums = sample === "all" ? "all" : Math.max(0, Number.parseInt(sample, 10) || 0);
    const counts =
      driver === "local"
        ? await inspectLocalFiles(rows, root, checksums)
        : { expected: rows.length, present: 0, missing: 0, sizeMismatch: 0, checksumChecked: 0, checksumMismatch: 0, noChecksum: 0, skippedUploading: 0, skippedPurged: 0, orphanObjects: 0, objectsScanned: 0 };
    const report = evaluateFiles(counts, { failOnOrphans: flag("--fail-on-orphans"), driver });
    report.checks.unshift(ownerCheck(bypass));
    report.ok = report.checks.every((c) => c.ok);
    return { report, text: formatChecks("Files and objects", report, `${rows.length} file rows`) };
  }),
);
