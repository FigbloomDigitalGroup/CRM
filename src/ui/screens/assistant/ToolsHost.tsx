"use client";

import { Command, HelpCircle, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { useContactSupport } from "../../data/supportContext";
import { CommandPalette } from "../palette/CommandPalette";
import { gotoShortcut } from "../palette/items";
import { HelpPanel } from "../palette/HelpPanel";
import { AssistantPanel } from "./AssistantPanel";
import { describeError } from "../../errors";
import { explainAssistantError, useAssistantActions, useAssistantSettings, type AssistantSettingsDto } from "./api";
import type { AskContext, ProposedAction } from "./types";

/**
 * The V1.1 tools in the shell (X2 Ask Figbloom, X3 command palette and help): three buttons in the top bar and the panels they open.
 * Wired to the real API (docs/RESTRUCTURE_LOG.md). Shown in every build: the server answers FEATURE_UNAVAILABLE for an organisation not on V1.1 (or without the assistant key), and the panels explain it.
 * One panel is open at a time, and Escape closes it.
 */
export function toolsEnabled(): boolean {
  return true;
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
      <button type="button" className="fb-cmdchip" aria-label="Command palette (Ctrl or Cmd K)" title="Command palette · Ctrl/Cmd+K" aria-expanded={panel === "palette"} onClick={() => toggle("palette")}>
        <Command size={14} aria-hidden="true" />K
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
  return { kind, name: `this ${kind}`, id: m[0].split("/")[2] };
}

/** Ask Figbloom's round button, fixed at the bottom right of the page (design X2). Hidden while its panel is open; when the organisation switched the assistant off it still opens, and says so. */
export function AssistantFab() {
  const panel = usePanel();
  if (!toolsEnabled() || panel === "assistant") return null;
  return (
    <button type="button" className="fb-fab" aria-label="Ask Figbloom assistant" title="Ask Figbloom" onClick={() => store.set("assistant")}>
      <Sparkles size={24} aria-hidden="true" />
    </button>
  );
}

/** The panels, and the keyboard shortcuts that open them. Mounted once in the shell. */
export function ToolsOverlays() {
  const panel = usePanel();
  const member = useMember();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const toast = useToast();
  const support = useContactSupport();
  const enabled = toolsEnabled();
  const settingsQuery = useAssistantSettings(enabled && panel === "assistant");
  const settings = settingsQuery.data as AssistantSettingsDto | undefined;
  const actions = useAssistantActions();

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

  const confirmAction = useCallback(
    async (action: ProposedAction) => {
      await actions.confirm(action);
      toast.show({ message: `Task created: ${action.title}` });
    },
    [actions, toast],
  );

  let unavailable: string | null = null;
  if (settingsQuery.error) unavailable = describeError(settingsQuery.error).kind === "noAccess" ? explainAssistantError(settingsQuery.error).text : "We could not check the assistant just now. Try again in a moment.";
  else if (settings && !settings.providerConfigured && settings.enabled) unavailable = "It is switched on, but this deployment has no assistant model connected yet. Ask whoever runs Figbloom to set it up.";

  if (!enabled) return null;
  return (
    <>
      <AssistantFab />
      <CommandPalette
        open={panel === "palette"}
        onClose={() => store.set(null)}
        orgSlug={orgSlug}
        permissionKeys={keys}
        onNavigate={go}
        onRun={(run) => {
          if (run === "support" && support) {
            store.set(null);
            support.open();
          } else store.set(run === "assistant" ? "assistant" : "help");
        }}
      />
      <AssistantPanel open={panel === "assistant"} onClose={() => store.set(null)} enabled={settings?.enabled ?? false} ctx={ctx} respond={actions.respond} onConfirmAction={confirmAction} onDismissAction={actions.dismiss} onFeedback={actions.feedback} usage={settings ? { today: settings.usage.today, limit: settings.limits.perUser } : null} unavailable={unavailable} loading={settingsQuery.isLoading} settingsHref={member.can("configuration.manage") ? `/o/${orgSlug}/settings?tab=ai` : undefined} />
      <HelpPanel open={panel === "help"} onClose={() => store.set(null)} pathname={pathname} orgSlug={orgSlug} />
    </>
  );
}
