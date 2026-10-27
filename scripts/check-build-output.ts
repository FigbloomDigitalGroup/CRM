import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Production build check (F1.07): nothing that exists only for development may be in `.next` after `next build`: not the dev sign-in chips,
 * not the code that draws them. Run by CI right after the build (`npm run check:build-output`), and by hand before a release.
 *
 * The markers are strings that appear only in those modules (see `src/app/_dev/`). A match anywhere in the server or client output fails the check.
 */

export const DEV_ONLY_MARKERS = ["data-figbloom-dev-chips", "Dev sign-in", "renderDevChips", "DevChipsPanel"];

const TEXT_EXTENSIONS = /\.(js|mjs|cjs|json|html|rsc|txt|css|map)$/;

export function findMarkers(root: string, markers: readonly string[] = DEV_ONLY_MARKERS): { file: string; marker: string }[] {
  const found: { file: string; marker: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        // The build cache holds compiled copies of source from earlier (development) builds; it is not shipped.
        if (name === "cache") continue;
        walk(path);
      } else if (TEXT_EXTENSIONS.test(name) && stat.size < 50_000_000) {
        const text = readFileSync(path, "utf8");
        for (const marker of markers) if (text.includes(marker)) found.push({ file: path, marker });
      }
    }
  };
  walk(root);
  return found;
}

if (process.argv[1] && /check-build-output/.test(process.argv[1])) {
  const dir = process.argv[2] ?? ".next";
  if (!existsSync(join(dir, "BUILD_ID"))) {
    console.error(`No production build in ${dir} (no BUILD_ID). Run "npm run build" first.`);
    process.exit(2);
  }
  const found = findMarkers(dir);
  if (found.length > 0) {
    console.error("Development-only code is in the production build:");
    for (const f of found) console.error(`  ${f.marker}  in  ${f.file}`);
    process.exit(1);
  }
  console.log(`Production build is clean: none of ${DEV_ONLY_MARKERS.length} dev-only markers found in ${dir}.`);
}
