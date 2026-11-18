import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Frontend performance budget, the build half (Q1.05, FIG-1119): the JavaScript a screen loads for the first time, gzip-compressed, per route,
 * read from `.next/app-build-manifest.json` after `next build`. A route over its budget fails the check (`npm run check:bundle-budget`, run by
 * CI after the build), so a regression fails the pull request that causes it.
 *
 * Budgets are for a mid-range Android on mobile data (docs/FRONTEND_PERFORMANCE.md): 300 KB gzipped of script per screen (measured on 31 Oct 2026: shared 167 KB,
 * heaviest route 272 KB, so about 10% headroom) is what a mid-range phone parses in about a second on a 4x slower CPU. The shared floor (React, Next, the app shell, the data layer) is measured
 * on its own so a screen's own weight is visible. Budgets are in KB (gzip) and only ever lowered, never raised, without Given's say-so.
 */

export const SHARED_BUDGET_KB = 185;
export const ROUTE_BUDGET_KB = 300;
/** Screens that need an explicit, justified allowance over the default (none today: the heaviest route measured 272 KB on 31 Oct 2026). */
export const ROUTE_ALLOWANCE_KB: Record<string, number> = {};

const ROOT = join(process.cwd(), process.env.NEXT_DIST_DIR || ".next");
const gzCache = new Map<string, number>();

function gzipKb(file: string): number {
  const hit = gzCache.get(file);
  if (hit !== undefined) return hit;
  const path = join(ROOT, file);
  const kb = existsSync(path) ? gzipSync(readFileSync(path)).length / 1024 : 0;
  gzCache.set(file, kb);
  return kb;
}

export interface RouteWeight {
  route: string;
  kb: number;
  budget: number;
}

export function measure(): { shared: number; routes: RouteWeight[] } {
  const manifest = JSON.parse(readFileSync(join(ROOT, "app-build-manifest.json"), "utf8")) as { pages: Record<string, string[]> };
  const rootMain = JSON.parse(readFileSync(join(ROOT, "build-manifest.json"), "utf8")) as { rootMainFiles?: string[] };
  const sharedFiles = (rootMain.rootMainFiles ?? []).filter((f) => f.endsWith(".js"));
  const shared = sharedFiles.reduce((n, f) => n + gzipKb(f), 0);
  const routes: RouteWeight[] = [];
  for (const [route, files] of Object.entries(manifest.pages)) {
    if (!route.endsWith("/page") || route.includes("/api/")) continue;
    const js = [...new Set(files.filter((f) => f.endsWith(".js")))];
    const kb = js.reduce((n, f) => n + gzipKb(f), 0);
    routes.push({ route, kb, budget: ROUTE_ALLOWANCE_KB[route] ?? ROUTE_BUDGET_KB });
  }
  return { shared, routes: routes.sort((a, b) => b.kb - a.kb) };
}

if (require.main === module) {
  const { shared, routes } = measure();
  const over = routes.filter((r) => r.kb > r.budget);
  console.log(`Shared first-load script: ${shared.toFixed(0)} KB gzip (budget ${SHARED_BUDGET_KB} KB)`);
  for (const r of routes.slice(0, 12)) console.log(`${r.kb > r.budget ? "OVER " : "ok   "} ${r.kb.toFixed(0).padStart(4)} KB / ${r.budget} KB  ${r.route}`);
  console.log(`${routes.length} routes measured, ${over.length} over budget.`);
  if (shared > SHARED_BUDGET_KB || over.length > 0) process.exit(1);
}
