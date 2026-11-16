import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_ALLOW_LIST } from "./fixtures/routeAllowList";

/**
 * P2-10 (FIG-1593): static route reachability. No server, build or database.
 *  1. Every page route is linked from the navigation or by a literal internal URL in source, is a redirect target in next.config,
 *     or is in tests/fixtures/routeAllowList.ts with a reason.
 *  2. Every literal internal path used in href / Link / router.push / replace / redirect() resolves to a page route.
 * `[param]` segments and `${...}` expressions are wildcards; query strings and hashes are dropped; paths built only from variables are ignored.
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

const routes = files
  .filter((f) => /[\\/]page\.tsx$/.test(f))
  .map((f) => {
    const parts = path.relative(path.join(SRC, "app"), path.dirname(f)).replace(/\\/g, "/").split("/");
    return "/" + parts.filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
  });

// Where an org-relative or variable-based path (`/tasks`, `${base}/tasks`) is rooted.
const BASES = ["/o/[orgSlug]", "/o/[orgSlug]/m", "/platform", "/platform/m"];

const segs = (p: string) => p.split("/").filter(Boolean);
function segMatch(cand: string, route: string): boolean {
  if (route.startsWith("[")) return true; // a dynamic route segment takes anything
  if (!cand.includes("*")) return cand === route;
  const re = new RegExp("^" + cand.split("*").map((s) => s.replace(/[.+?^$()|[\]\\{}]/g, "\\$&")).join(".*") + "$");
  return re.test(route);
}
function segsMatch(cand: string[], route: string[]): boolean {
  return cand.length === route.length && cand.every((c, i) => segMatch(c, route[i]));
}
function normalise(raw: string): string | null {
  let s = raw.replace(/\$\{[^}]*\}/g, "*");
  s = s.split(/[?#]/)[0];
  if (!s.startsWith("/") && !s.startsWith("*/")) return null;
  if (s.replace(/[*/]/g, "") === "" && s !== "/") return null; // built entirely from variables
  if (/\s/.test(s) || /^\/(api|_next)(\/|$)/.test(s) || s.startsWith("//")) return null;
  return s;
}
/** Which routes a normalised literal points at. */
function resolve(cand: string): string[] {
  const c = segs(cand);
  const leading = c[0] === "*" && cand.startsWith("*/");
  const tail = leading ? c.slice(1) : c;
  const hit = new Set<string>();
  for (const r of routes) {
    const rs = segs(r);
    if (!leading && segsMatch(c, rs)) hit.add(r);
    for (const b of BASES) {
      const bs = segs(b);
      const underBase = rs.length >= bs.length && bs.every((x, i) => x === rs[i]);
      if (underBase && rs.length > bs.length && segsMatch(tail, rs.slice(bs.length))) hit.add(r);
    }
  }
  return [...hit];
}

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const LINK_USE =
  /(?:href\s*=\s*\{?\s*|href:\s*|\bpush\(\s*|\breplace\(\s*|\bredirect\(\s*|\bpermanentRedirect\(\s*)(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

const reachable = new Set<string>();
const linkUses: { file: string; raw: string; norm: string }[] = [];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(LITERAL)) {
    const n = normalise(m[2]);
    if (n) for (const r of resolve(n)) reachable.add(r);
  }
  for (const m of text.matchAll(LINK_USE)) {
    const n = normalise(m[2]);
    if (n) linkUses.push({ file: rel(f), raw: m[2], norm: n });
  }
}
// Redirect targets declared in next.config.
try {
  const cfg = fs.readFileSync(path.join(ROOT, "next.config.js"), "utf8");
  for (const m of cfg.matchAll(/destination:\s*["'`]([^"'`]+)["'`]/g)) {
    const n = normalise(m[1]);
    if (n) for (const r of resolve(n)) reachable.add(r);
  }
} catch {
  /* no config */
}

const isPublicFile = (n: string) => !n.includes("*") && fs.existsSync(path.join(ROOT, "public", n));

describe("route reachability (P2-10)", () => {
  it("finds the page routes", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("every page route is linked, a redirect target, or allow-listed with a reason", () => {
    const unreachable = routes.filter((r) => !reachable.has(r) && !(r in ROUTE_ALLOW_LIST)).sort();
    expect(unreachable, `Unreachable routes (link them, or add each to tests/fixtures/routeAllowList.ts with a reason):\n${unreachable.join("\n")}\n`).toEqual([]);
  });

  it("the allow-list has a reason for each entry, names real routes, and holds nothing that is linked now", () => {
    const bad = Object.entries(ROUTE_ALLOW_LIST).filter(([r, why]) => !routes.includes(r) || why.trim().length < 10).map(([r]) => r);
    expect(bad, `Allow-list entries with no reason or no such route:\n${bad.join("\n")}`).toEqual([]);
    const stale = Object.keys(ROUTE_ALLOW_LIST).filter((r) => reachable.has(r));
    expect(stale, `Allow-listed but already linked (remove from the list):\n${stale.join("\n")}`).toEqual([]);
  });

  it("no internal link points at a page that does not exist", () => {
    const broken = [...new Set(linkUses.filter((u) => resolve(u.norm).length === 0 && !isPublicFile(u.norm)).map((u) => `${u.file}: ${u.raw}`))];
    expect(broken, `Broken internal links:\n${broken.join("\n")}\n`).toEqual([]);
  });
});
