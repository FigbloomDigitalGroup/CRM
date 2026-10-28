"use client";

import { Bell, RotateCcw, Shield, SlidersHorizontal, User } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/ui";
import { AppearanceTab } from "./AppearanceTab";
import { NotificationsTab } from "./NotificationsTab";
import { ProfileTab } from "./ProfileTab";
import { SecurityTab } from "./SecurityTab";
import { TAB_IDS, type TabId } from "./model";

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Appearance", icon: SlidersHorizontal },
  { id: "security", label: "Security", icon: Shield },
];

/**
 * Preferences (F4.01 to F4.03, design AP1 to AP8): four tabs, each about the signed-in person only. The tab is in the address
 * (`?tab=`), so a link opens the right one.
 */
export function PreferencesScreen({ initialTab = "appearance" }: { initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [resetOpen, setResetOpen] = useState(false);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function go(id: TabId) {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(null, "", url);
    } catch {
      // The tab still switches without the address.
    }
  }

  function onKey(e: KeyboardEvent, id: TabId) {
    const i = TAB_IDS.indexOf(id);
    const next = e.key === "ArrowRight" ? (i + 1) % TAB_IDS.length : e.key === "ArrowLeft" ? (i - 1 + TAB_IDS.length) % TAB_IDS.length : e.key === "Home" ? 0 : e.key === "End" ? TAB_IDS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    go(TAB_IDS[next]!);
    refs.current[TAB_IDS[next]!]?.focus();
  }

  return (
    <div className="fb-prefs fb-page-list" data-testid="preferences">
      <div className="fb-prefs__head">
        <div>
          <h1 className="fb-prefs__title">Preferences</h1>
          <p className="fb-prefs__sub">This only changes your own settings, not anyone else’s.</p>
        </div>
        {tab === "appearance" ? (
          <Button onClick={() => setResetOpen(true)}>
            <RotateCcw size={15} aria-hidden="true" />
            Reset to default
          </Button>
        ) : null}
      </div>
      <div role="tablist" aria-label="Preferences" className="fb-prefs__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`prefs-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`prefs-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => go(t.id)}
            onKeyDown={(e) => onKey(e, t.id)}
          >
            <t.icon size={15} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`prefs-panel-${tab}`} aria-labelledby={`prefs-tab-${tab}`}>
        {tab === "profile" ? <ProfileTab /> : null}
        {tab === "notifications" ? <NotificationsTab /> : null}
        {tab === "appearance" ? <AppearanceTab resetOpen={resetOpen} onResetClose={() => setResetOpen(false)} /> : null}
        {tab === "security" ? <SecurityTab /> : null}
      </div>
    </div>
  );
}
