import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ROLE_PERMISSIONS } from "../../../prisma/seedData";
import { buildCommands } from "../../../src/lib/commandIndex";
import { PLATFORM_NAV } from "../../../src/ui/screens/platform/PlatformShell";
import { ACTIONS, GOTO, buildPaletteItems } from "../../../src/ui/screens/palette/items";
import { mobileTabs } from "../../../src/ui/screens/mobile/tabs";
import { buildNav, buildQuickCreate } from "../../../src/ui/shell/navigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
const { SETTINGS_TABS } = await import("../../../src/ui/screens/settings/SettingsScreen");

/**
 * "No link in the app leads to a 404", without a browser. Every navigation link a person can be offered is collected from the same functions the shell
 * uses (sidebar, quick create, top bar, notifications, help, command palette and its server index, phone tabs, Settings sections, the platform console),
 * once per role, and checked against the real route table under src/app: the page must exist and must not be a bare `notFound()`. V2 screens
 * (FIG-1192 to FIG-1194) must be reachable from nowhere. Run: npx vitest run --project components tests/components/navigation/navLinks.test.tsx
 */

const APP = path.resolve(__dirname, "../../../src/app");
const ROOT = path.resolve(__dirname, "../../..");
const ORG = "figbloom";

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const ROUTES = pages(APP).map((file) => {
  const route = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !/^\(.*\)$/.test(s));
  return { file, route };
});

function resolve(href: string) {
  const clean = href.split("#")[0]!.split("?")[0]!.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  const matches = ROUTES.filter(({ route }) => route.length === parts.length && route.every((seg, i) => /^\[.+\]$/.test(seg) || seg === parts[i]));
  // A static page wins over a dynamic one, as in Next.
  return matches.sort((a, b) => a.route.filter((s) => s.startsWith("[")).length - b.route.filter((s) => s.startsWith("[")).length)[0] ?? null;
}

const bareNotFound = (file: string) => /export default (async )?function \w*\([^)]*\)\s*\{\s*notFound\(\);/.test(readFileSync(file, "utf8"));

/** V2 (FIG-1192, FIG-1193, FIG-1194): linked from nowhere. */
const V2_HREFS = [/\/platform\/support-access/, /\/platform\/flags/, /\/platform\/announcements/, /\/sign\//, /[?&]tab=(roles|developers|supporthistory)\b/, /\/api-tokens/, /\/webhooks/];

const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const;

function tenantLinks(role: (typeof ROLES)[number]): string[] {
  const keys = ROLE_PERMISSIONS[role]!;
  const base = `/o/${ORG}`;
  const links: string[] = [];
  for (const s of buildNav({ permissionKeys: keys, membershipId: "m1" })) for (const i of s.items) links.push(`${base}${i.path}`);
  for (const q of buildQuickCreate({ permissionKeys: keys, membershipId: "m1" })) links.push(`${base}${q.path}`);
  // Top bar, notification panel, Help.
  links.push(`${base}/preferences`, `${base}/notifications`, `${base}/help`, `${base}/help/whats-new`, `${base}/search`);
  if (keys.includes("configuration.manage")) links.push(`${base}/settings`);
  // Command palette: the local tables, and the server's index for an organisation on V1.1.
  for (const g of GOTO.filter((x) => x.allowed(keys))) links.push(`${base}${g.path}`);
  for (const a of ACTIONS.filter((x) => x.allowed(keys) && x.path)) links.push(`${base}${a.path}`);
  for (const g of buildPaletteItems({ orgSlug: ORG, permissionKeys: keys, query: "" })) for (const i of g.items) if (i.href) links.push(i.href);
  for (const c of buildCommands({ permissionKeys: keys, release: "v1.1", toggles: { "assistant.enabled": true } })) if (c.path !== null) links.push(`${base}${c.path}`);
  // The phone's bottom bar.
  for (const t of mobileTabs(keys)) if (!t.center) links.push(`${base}/m${t.path}`);
  return links;
}

describe("every navigation link resolves to a real page", () => {
  for (const role of ROLES) {
    it(`${role}: sidebar, quick create, top bar, palette and phone tabs`, () => {
      const links = [...new Set(tenantLinks(role))];
      expect(links.length).toBeGreaterThan(5);
      const dead = links.filter((href) => {
        const hit = resolve(href);
        return !hit || bareNotFound(hit.file);
      });
      expect(dead).toEqual([]);
      for (const href of links) for (const v2 of V2_HREFS) expect(href, `${role} is offered a V2 link`).not.toMatch(v2);
    });
  }

  it("Settings (Management): every section is a real tab, nothing is V2, and every ?tab= used elsewhere exists", () => {
    const ids = SETTINGS_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(resolve(`/o/${ORG}/settings`)).not.toBeNull();
    for (const v2 of ["roles", "developers", "supporthistory"]) expect(ids).not.toContain(v2);
    expect(SETTINGS_TABS.map((t) => t.label.toLowerCase()).join("|")).not.toMatch(/developers|api token|webhook|roles & field access|support access/);
    // Tabs linked from the home checklist, the Integrations list, the assistant and the OAuth callback.
    const used = new Set<string>(["members", "migration", "website", "email", "ai", "connect"]);
    for (const file of ["src/ui/screens/home/roles.tsx", "src/ui/screens/settings/Integrations.tsx", "src/ui/screens/assistant/ToolsHost.tsx", "src/app/api/integrations/oauth/callback/route.ts"]) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      for (const m of text.matchAll(/tab=([a-z0-9]+)/g)) used.add(m[1]!);
      for (const m of text.matchAll(/(?:WEBSITE|INBOUND_EMAIL): "([a-z]+)"/g)) used.add(m[1]!);
    }
    expect([...used].filter((t) => !ids.includes(t))).toEqual([]);
  });

  it("platform console: every navigation item, the account menu and the sign-in steps resolve; V2 pages are not linked and answer 404", () => {
    const links = [...PLATFORM_NAV.map((n) => n.path), "/platform/preferences", "/platform/sign-in", "/platform/verify", "/platform/m", "/platform/m/health", "/platform/m/approvals"];
    expect(links.filter((href) => !resolve(href) || bareNotFound(resolve(href)!.file))).toEqual([]);
    for (const href of links) for (const v2 of V2_HREFS) expect(href).not.toMatch(v2);
    for (const v2 of ["support-access", "flags", "announcements"]) {
      const hit = resolve(`/platform/${v2}`)!;
      expect(hit && bareNotFound(hit.file), `/platform/${v2} must answer 404`).toBe(true);
    }
  });

  it("the signing link answers a plain 'not available' page with no demo data", () => {
    const hit = resolve("/sign/some-token")!;
    const source = readFileSync(hit.file, "utf8");
    expect(source).toMatch(/not available/i);
    expect(source).not.toMatch(/demoSigning|demo-unsigned|SignClient/);
  });

  it("no demo gate or demo cookie is left in the app routes and shell", () => {
    const files = [...ROUTES.map((r) => r.file), path.join(APP, "o/[orgSlug]/layout.tsx"), path.join(APP, "platform/requireConsole.ts")];
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/demoScreensEnabled|DEMO_SCREENS|fb_demo_/);
  });
});
