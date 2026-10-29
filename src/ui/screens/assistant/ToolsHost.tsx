"use client";

import { Command, HelpCircle, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { CommandPalette } from "../palette/CommandPalette";
import { gotoShortcut } from "../palette/items";
import { HelpPanel } from "../palette/HelpPanel";
import { AssistantPanel } from "./AssistantPanel";
import { readAiSettings } from "./demo/data";
import type { AskContext, ProposedAction } from "./types";

/**
 * The V1.1 tools in the shell (X2 Ask Figbloom, X3 command palette and help): three buttons in the top bar and the panels they open.
 * Reachable outside production, or where `NEXT_PUBLIC_DEMO_SCREENS=true`, until the tools are wired to the real API (docs/RESTRUCTURE_LOG.md);
 * the release flag check joins it then. One panel is open at a time, and Escape closes it.
 */
export function toolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.NEXT_PUBLIC_DEMO_SCREENS === "true";
}

type Panel = "palette" | "assistant" | "help" | null;
let current: Panel = null;
const listeners = new Set<() => void>();
const store = {
  get: () => current,
  set(next: Panel) {
    current = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
export const toolsPanel = store;

function usePanel(): Panel {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

/** True when the key press is going into a field, so single-letter shortcuts must stay out of the way. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/** The buttons for the top bar. */
export function ToolsTriggers() {
  const panel = usePanel();
  if (!toolsEnabled()) return null;
  const toggle = (p: Exclude<Panel, null>) => store.set(panel === p ? null : p);
  return (
    <>
      <button type="button" className="fb-roundbtn" aria-label="Command palette (Ctrl or Cmd K)" title="Command palette (Ctrl/Cmd K)" aria-expanded={panel === "palette"} onClick={() => toggle("palette")}>
        <Command size={17} aria-hidden="true" />
      </button>
      <button type="button" className="fb-roundbtn" aria-label="Ask Figbloom" title="Ask Figbloom" aria-expanded={panel === "assistant"} onClick={() => toggle("assistant")}>
        <Sparkles size={17} aria-hidden="true" />
      </button>
      <button type="button" className="fb-roundbtn" aria-label="Help and what’s new" title="Help (?)" aria-expanded={panel === "help"} onClick={() => toggle("help")}>
        <HelpCircle size={17} aria-hidden="true" />
      </button>
    </>
  );
}

function recordFrom(pathname: string, orgSlug: string): AskContext["record"] {
  const m = pathname.replace(`/o/${orgSlug}`, "").match(/^\/(leads|deals|companies)\/[^/]+/);
  if (!m) return null;
  const kind = m[1] === "leads" ? "lead" : m[1] === "deals" ? "deal" : "company";
  return { kind, name: `this ${kind}` };
}

/** The panels, and the keyboard shortcuts that open them. Mounted once in the shell. */
export function ToolsOverlays() {
  const panel = usePanel();
  const member = useMember();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const toast = useToast();
  const [aiOn, setAiOn] = useState(true);
  const enabled = toolsEnabled();

  useEffect(() => {
    const read = () => setAiOn(readAiSettings().assist);
    read();
    window.addEventListener("figbloom-ai-settings", read);
    return () => window.removeEventListener("figbloom-ai-settings", read);
  }, []);

  const keys = member.permissionKeys;
  const orgSlug = member.orgSlug;
  const go = useCallback((href: string) => router.push(href), [router]);

  useEffect(() => {
    if (!enabled) return;
    let g = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        store.set(store.get() === "palette" ? null : "palette");
        return;
      }
      if (e.key === "Escape") {
        if (store.get()) store.set(null);
        return;
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || store.get() === "palette") return;
      if (g) {
        g = false;
        if (timer) clearTimeout(timer);
        const href = gotoShortcut(e.key, keys, orgSlug);
        if (href) router.push(href);
        return;
      }
      if (e.key === "g") {
        g = true;
        timer = setTimeout(() => (g = false), 1500);
      } else if (e.key === "n" && keys.includes("leads.create")) router.push(`/o/${orgSlug}/leads?new=1`);
      else if (e.key === "?") store.set("help");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, keys, orgSlug, router]);

  const ctx: AskContext = useMemo(() => ({ orgSlug, roleName: member.roleName, permissionKeys: keys, record: recordFrom(pathname, orgSlug) }), [orgSlug, member.roleName, keys, pathname]);

  // Demo: the confirmed task is kept on this device; the real call replaces it in M13.
  const confirmAction = useCallback(
    (action: ProposedAction) => {
      try {
        const k = `figbloom-demo-assistant-tasks:${orgSlug}`;
        const list = JSON.parse(localStorage.getItem(k) ?? "[]") as ProposedAction[];
        localStorage.setItem(k, JSON.stringify([...list, action]));
      } catch {
        /* blocked storage: the demo task is simply not remembered */
      }
      toast.show({ message: `Task created: ${action.title}` });
    },
    [orgSlug, toast],
  );

  if (!enabled) return null;
  return (
    <>
      <CommandPalette
        open={panel === "palette"}
        onClose={() => store.set(null)}
        orgSlug={orgSlug}
        permissionKeys={keys}
        onNavigate={go}
        onRun={(run) => store.set(run === "assistant" ? "assistant" : "help")}
      />
      <AssistantPanel open={panel === "assistant"} onClose={() => store.set(null)} enabled={aiOn} ctx={ctx} onConfirmAction={confirmAction} settingsHref={member.can("configuration.manage") ? `/o/${orgSlug}/settings?tab=ai` : undefined} />
      <HelpPanel open={panel === "help"} onClose={() => store.set(null)} pathname={pathname} orgSlug={orgSlug} />
    </>
  );
}
