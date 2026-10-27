"use client";

import { LogOut, Menu as MenuIcon, Moon, Plus, Sun, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Avatar, Banner } from "../components/basics";
import { Menu, Popover, type MenuItem } from "../components/overlays";
import { useToast } from "../components/toast";
import { useApi } from "../data/hooks";
import { useAppearanceOptional } from "../theme/ThemeProvider";
import type { QuickCreateItem } from "./navModel";

/* Quick create ---------------------------------------------------------------------------------------------------------------- */

/**
 * The "+ New" menu: only what this person may create. Inside an archived or read-only record the whole menu is disabled with the reason
 * rather than disappearing, so the person is not left wondering where it went.
 */
export function QuickCreate({ orgSlug, items, disabledReason }: { orgSlug: string; items: QuickCreateItem[]; disabledReason?: string }) {
  if (items.length === 0) return null;
  if (disabledReason) {
    return (
      <button type="button" className="fb-btn fb-btn--primary" aria-disabled="true" title={disabledReason}>
        <Plus size={16} aria-hidden="true" /> New
        <span className="fb-sr-only"> (unavailable: {disabledReason})</span>
      </button>
    );
  }
  const menu: MenuItem[] = items.map((i) => ({ key: i.key, label: i.label, href: `/o/${orgSlug}${i.path}` }));
  return (
    <Menu
      label="New"
      trigger={
        <>
          <Plus size={16} aria-hidden="true" /> New
        </>
      }
      items={menu}
      triggerClassName="fb-btn fb-btn--primary"
    />
  );
}

/* Light and dark ----------------------------------------------------------------------------------------------------------------- */

/** The top-bar light/dark switch. Stored on this device. Disabled, with the reason, while the organisation has locked the look. */
export function ThemeSwitch() {
  const appearance = useAppearanceOptional();
  if (!appearance) return null;
  const dark = appearance.scheme === "dark";
  const label = appearance.locked ? "Your organisation has set the colours, so light and dark cannot be switched" : dark ? "Switch to light" : "Switch to dark";
  return (
    <button type="button" className="fb-iconbtn" aria-label={label} title={label} aria-disabled={appearance.locked || undefined} onClick={appearance.toggleScheme}>
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

/* Identity ------------------------------------------------------------------------------------------------------------------------ */

export interface IdentityInfo {
  name: string;
  roleName: string;
  organisation: string;
  avatarUrl: string | null;
  /** "Tuesday, 27 October, 10:04", written in the person's own zone and hour format. */
  signedInLocal: string | null;
  device: string | null;
  place: string | null;
  timeZone: string | null;
  /** The organisation's zone, when it differs from the person's. */
  organisationTimeZone: string | null;
  supportNotice: string | null;
  preferencesHref: string;
}

/**
 * Who you are, where you are and since when (TB1 to TB3): avatar or initials, name, role, organisation, the sign-in time and time zone. The
 * popover has the profile and preferences link, sign out, sign out other devices and, while Figbloom Support is looking at the organisation, a notice.
 * At phone width the popover becomes a bottom sheet (CSS) and the text collapses to the avatar.
 */
export function IdentityBlock({ identity }: { identity: IdentityInfo }) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api.call("logout", { params: {} });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }
  async function signOutOthers() {
    setBusy(true);
    try {
      await api.call("signOutOtherSessions", { params: {} });
      toast.show({ message: "Signed out of your other devices." });
    } catch {
      toast.show({ tone: "danger", message: "Could not sign out the other devices. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      label={`Account: ${identity.name}`}
      align="end"
      className="fb-identity-pop"
      triggerClassName="fb-identity"
      trigger={
        <>
          <Avatar name={identity.name} src={identity.avatarUrl} size={36} />
          <span className="fb-identity__text">
            <span className="fb-identity__name">{identity.name}</span>
            <span className="fb-identity__meta">
              {identity.roleName} · {identity.organisation}
            </span>
          </span>
        </>
      }
    >
      {(close) => (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 8 }}>
            <Avatar name={identity.name} src={identity.avatarUrl} size={44} />
            <div>
              <strong>{identity.name}</strong>
              <div className="fb-help">{identity.roleName}</div>
            </div>
          </div>
          <dl>
            <dt>Organisation</dt>
            <dd>{identity.organisation}</dd>
            {identity.signedInLocal ? (
              <>
                <dt>Signed in</dt>
                <dd>{identity.signedInLocal}</dd>
              </>
            ) : null}
            {identity.timeZone ? (
              <>
                <dt>Time zone</dt>
                <dd>
                  {identity.timeZone}
                  {identity.organisationTimeZone ? ` (organisation: ${identity.organisationTimeZone})` : ""}
                </dd>
              </>
            ) : null}
            {identity.device ? (
              <>
                <dt>Device</dt>
                <dd>{[identity.device, identity.place].filter(Boolean).join(" · ")}</dd>
              </>
            ) : null}
          </dl>
          {identity.supportNotice ? <div style={{ marginBottom: 8 }}><Banner tone="info" icon={<Users size={16} />}>{identity.supportNotice}</Banner></div> : null}
          <a className="fb-menuitem" href={identity.preferencesHref} onClick={close}>Profile and preferences</a>
          <button type="button" className="fb-menuitem" aria-disabled={busy || undefined} onClick={signOutOthers}>Sign out other devices</button>
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "6px 0" }} />
          <button type="button" className="fb-menuitem fb-menuitem--danger" aria-disabled={busy || undefined} onClick={signOut}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </Popover>
  );
}

/* The bar ---------------------------------------------------------------------------------------------------------------------- */

export function TopBar({
  dateLabel,
  search,
  bell,
  quickCreate,
  identity,
  organisationSwitcher,
  onOpenNav,
}: {
  dateLabel: string;
  search: ReactNode;
  bell: ReactNode;
  quickCreate: ReactNode;
  identity: ReactNode;
  /** The switcher slot: present in the layout, empty until V1.1 turns it on. */
  organisationSwitcher?: ReactNode;
  onOpenNav: () => void;
}) {
  return (
    <header className="fb-topbar">
      <button type="button" className="fb-iconbtn fb-sheet-trigger" aria-label="Open navigation" onClick={onOpenNav}>
        <MenuIcon size={20} aria-hidden="true" />
      </button>
      <span className="fb-topbar__date">{dateLabel}</span>
      <div className="fb-topbar__search">{search}</div>
      <div className="fb-topbar__right">
        {organisationSwitcher}
        {quickCreate}
        {bell}
        <ThemeSwitch />
        {identity}
      </div>
    </header>
  );
}
