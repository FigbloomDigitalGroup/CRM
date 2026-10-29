"use client";

import { ChevronDown, LogOut, Menu as MenuIcon, Moon, Plus, Sun, User, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";
import { Avatar, Banner } from "../components/basics";
import { Menu, Popover, type MenuItem } from "../components/overlays";
import { useToast } from "../components/toast";
import { useApi } from "../data/hooks";
import { useAppearanceOptional } from "../theme/ThemeProvider";
import type { QuickCreateItem } from "./navModel";

/* Quick create ---------------------------------------------------------------------------------------------------------------- */

/**
 * The round "+" at the right of the bar (named "New" for assistive technology, "Add new" on hover): only what this person may create. Inside an
 * archived or read-only record it is disabled with the reason rather than disappearing, so the person is not left wondering where it went.
 */
export function QuickCreate({ orgSlug, items, disabledReason }: { orgSlug: string; items: QuickCreateItem[]; disabledReason?: string }) {
  if (items.length === 0) return null;
  if (disabledReason) {
    return (
      <button type="button" className="fb-roundbtn fb-roundbtn--primary" aria-disabled="true" title={disabledReason}>
        <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
        <span className="fb-sr-only">New (unavailable: {disabledReason})</span>
      </button>
    );
  }
  const menu: MenuItem[] = items.map((i) => ({ key: i.key, label: i.label, href: `/o/${orgSlug}${i.path}` }));
  return (
    <Menu
      label="New"
      align="end"
      trigger={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}
      items={menu}
      triggerClassName="fb-roundbtn fb-roundbtn--primary"
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
    <button type="button" className="fb-roundbtn" aria-label={label} title={label} aria-disabled={appearance.locked || undefined} onClick={appearance.toggleScheme}>
      {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}

/* Identity ------------------------------------------------------------------------------------------------------------------------ */

export interface IdentityInfo {
  name: string;
  email?: string | null;
  roleName: string;
  /** The role's workspace label ("Sales", "Finance"), shown beside the sign-in time. Falls back to the role name. */
  workspaceLabel?: string | null;
  organisation: string;
  /** The organisation's logo, when it has uploaded one. Without it the tile shows the Figbloom mark. */
  logoUrl?: string | null;
  avatarUrl: string | null;
  /** "Tuesday, 27 October, 10:04", written in the person's own zone and hour format. */
  signedInLocal: string | null;
  /** Just the clock time, "10:04", shown under the organisation name. */
  signedInTime?: string | null;
  device: string | null;
  place: string | null;
  /** "7 h 52 min left", worked out when the page was built. */
  sessionLeft?: string | null;
  timeZone: string | null;
  /** The organisation's zone, when it differs from the person's. */
  organisationTimeZone: string | null;
  supportNotice: string | null;
  preferencesHref: string;
}

function OrgTile({ identity, size }: { identity: IdentityInfo; size: number }) {
  return (
    <span className="fb-orgtile" style={{ width: size, height: size, borderRadius: size >= 44 ? 12 : 10 }} aria-hidden="true">
      {identity.logoUrl ? <img src={identity.logoUrl} alt="" /> : <BrandMark className="fb-orgtile__mark" idSuffix={`-org${size}`} />}
    </span>
  );
}

/**
 * Where you are and since when (TB1 and TB2), at the left of the bar: the organisation's tile and name, the workspace and the sign-in time.
 * Opens the organisation and session card: who you are here, device, session time left, time zone, and the links to profile and to signing
 * out the other devices. At phone width the card becomes a bottom sheet (CSS) and the text collapses to the tile.
 */
export function OrgIdentity({ identity }: { identity: IdentityInfo }) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

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

  const label = identity.workspaceLabel || identity.roleName;
  return (
    <div className="fb-orgblock">
      <Popover
        label="Organisation and session"
        align="start"
        className="fb-orgpop"
        triggerClassName="fb-orgblock__trigger"
        trigger={
          <>
            <OrgTile identity={identity} size={36} />
            <span className="fb-orgblock__text">
              <span className="fb-orgblock__name">{identity.organisation}</span>
              <span className="fb-orgblock__meta">
                {label}
                {identity.signedInTime ? ` · Signed in ${identity.signedInTime}` : ""}
              </span>
            </span>
          </>
        }
      >
        {(close) => (
          <div>
            <div className="fb-orgpop__head">
              <OrgTile identity={identity} size={44} />
              <div>
                <div className="fb-orgpop__name">{identity.organisation}</div>
                <div className="fb-orgpop__role">
                  You’re <strong>{identity.roleName}</strong> here
                </div>
              </div>
            </div>
            {identity.supportNotice ? (
              <div className="fb-orgpop__notice">
                <Banner tone="info" icon={<Users size={16} />}>
                  {identity.supportNotice}
                </Banner>
              </div>
            ) : null}
            <dl>
              {identity.signedInLocal ? (
                <>
                  <dt>Signed in</dt>
                  <dd>{identity.signedInLocal}</dd>
                </>
              ) : null}
              {identity.device ? (
                <>
                  <dt>Device</dt>
                  <dd>{[identity.device, identity.place].filter(Boolean).join(", ")}</dd>
                </>
              ) : null}
              {identity.sessionLeft ? (
                <>
                  <dt>Session</dt>
                  <dd>{identity.sessionLeft}</dd>
                </>
              ) : null}
              {identity.timeZone ? (
                <>
                  <dt>Time zone</dt>
                  <dd className={identity.organisationTimeZone ? "fb-orgpop__warn" : undefined}>
                    {identity.timeZone}
                    {identity.organisationTimeZone ? ` (organisation: ${identity.organisationTimeZone})` : ""}
                  </dd>
                </>
              ) : null}
            </dl>
            <div className="fb-orgpop__links">
              <a className="fb-menuitem" href={identity.preferencesHref} onClick={close}>
                <User size={15} aria-hidden="true" /> Profile and preferences
              </a>
              <button type="button" className="fb-menuitem" aria-disabled={busy || undefined} onClick={signOutOthers}>
                <LogOut size={15} aria-hidden="true" /> Sign out other devices
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

/**
 * Your name at the right of the bar: a round chip with your initial, name and role. Opens your card (name, email, role), the profile link, the
 * light/dark switch and Sign out.
 */
export function UserMenu({ identity }: { identity: IdentityInfo }) {
  const api = useApi();
  const router = useRouter();
  const appearance = useAppearanceOptional();
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

  const dark = appearance?.scheme === "dark";
  const themeLocked = Boolean(appearance?.locked);
  return (
    <Popover
      label={`Account: ${identity.name}`}
      align="end"
      className="fb-usermenu"
      triggerClassName="fb-userchip"
      trigger={
        <>
          <span className="fb-userchip__dot" aria-hidden="true">
            {identity.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="fb-userchip__text">
            <span className="fb-userchip__name">{identity.name}</span>
            <span className="fb-userchip__role">{identity.roleName}</span>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div>
          <div className="fb-usermenu__head">
            <div className="fb-usermenu__name">
              <Avatar name={identity.name} src={identity.avatarUrl} size={28} /> {identity.name}
            </div>
            {identity.email ? <div className="fb-usermenu__email">{identity.email}</div> : null}
            <span className="fb-usermenu__role">{identity.roleName}</span>
          </div>
          <a className="fb-menuitem" href={identity.preferencesHref} onClick={close}>
            <User size={16} aria-hidden="true" /> Profile and preferences
          </a>
          {appearance ? (
            <button
              type="button"
              className="fb-menuitem"
              aria-disabled={themeLocked || undefined}
              title={themeLocked ? "Your organisation has set the colours, so light and dark cannot be switched" : undefined}
              onClick={() => {
                if (!themeLocked) appearance.toggleScheme();
              }}
            >
              {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />} {dark ? "Light mode" : "Dark mode"}
            </button>
          ) : null}
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
  orgIdentity,
  search,
  bell,
  quickCreate,
  userMenu,
  organisationSwitcher,
  tools,
  onOpenNav,
}: {
  /** The organisation and session block at the left. */
  orgIdentity: ReactNode;
  search: ReactNode;
  bell: ReactNode;
  quickCreate: ReactNode;
  userMenu: ReactNode;
  /** The switcher slot: present in the layout, empty until V1.1 turns it on. */
  organisationSwitcher?: ReactNode;
  /** Ask Figbloom, the command palette and Help buttons (X2, X3). Left out when the tools are off. */
  tools?: ReactNode;
  onOpenNav: () => void;
}) {
  return (
    <header className="fb-topbar">
      <button type="button" className="fb-iconbtn fb-sheet-trigger" aria-label="Open navigation" onClick={onOpenNav}>
        <MenuIcon size={20} aria-hidden="true" />
      </button>
      {orgIdentity}
      <div className="fb-topbar__search">{search}</div>
      <div className="fb-topbar__right">
        {organisationSwitcher}
        {quickCreate}
        {tools}
        {bell}
        <ThemeSwitch />
        {userMenu}
      </div>
    </header>
  );
}
