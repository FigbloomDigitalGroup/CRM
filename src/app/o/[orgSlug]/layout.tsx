import "@/ui/ui.css";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UnauthorizedError } from "@/auth/errors";
import { resolveRequestContext, resolveUserContext } from "@/auth/requestContext";
import { getMemberContext } from "@/services/meContextService";
import { MemberProvider } from "@/ui/data/member";
import { AppShell } from "@/ui/shell/AppShell";
import { buildNav, buildQuickCreate } from "@/ui/shell/navigation";
import { NoFlashScript } from "@/ui/theme/NoFlashScript";
import { ThemeProvider } from "@/ui/theme/ThemeProvider";
import { defaultLook, type LookInput } from "@/ui/theme/resolve";
import { NotificationBell } from "@/ui/screens/home/Notifications";
import { GlobalSearch } from "@/ui/screens/home/Search";
import { ApiProvider } from "@/ui/data/hooks";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { OrgBanners } from "@/ui/screens/orgside/OrgBanners";
import { OrgSwitcher } from "@/ui/screens/orgside/OrgSwitcher";
import { SuspendedScreen } from "@/ui/screens/orgside/SuspendedScreen";

/** `cover` lets the phone layout's bottom bar and sheets sit above the home indicator (env(safe-area-inset-bottom)). The sign-in pages are unaffected. */
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" } as const;

/**
 * The authenticated frame (F1.01 to F1.04): one call for everything the shell draws (`getMemberContext`, the same data as `GET /api/me/context`),
 * the member's look applied before first paint, a role-aware sidebar, and the top bar with the identity block. Hiding a link a role cannot use is
 * a courtesy; every page and every route still enforces its own permission.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let ctx;
  let me;
  try {
    ctx = await resolveRequestContext(orgSlug);
    const identity = await resolveUserContext();
    me = await getMemberContext({ userId: identity.userId, session: identity.session, orgSlug });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login");
    }
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="error">{err instanceof Error ? err.message : "Access denied."}</p>
        </div>
      </div>
    );
  }

  // OS1 (FIG-1166): a suspended organisation gets the paused screen instead of the shell, whatever page was asked for. Demo cookie until B6.05.
  const demoScreens = demoScreensEnabled();
  if (demoScreens && (await cookies()).get("fb_demo_suspended")?.value === "1") {
    return (
      <ThemeProvider initialLook={defaultLook()} initialDensity={me.preferences?.density}>
        <NoFlashScript />
        <ApiProvider>
          <SuspendedScreen organisation={me.organisation?.shownName ?? me.organisation?.name ?? ""} demo />
        </ApiProvider>
      </ThemeProvider>
    );
  }

  const navInput = { permissionKeys: ctx.permissionKeys, membershipId: ctx.membershipId, hidden: me.preferences?.sidebar.hidden ?? [] };
  const look: LookInput = me.look
    ? { locked: me.look.locked, toggle: me.look.toggle, colours: me.look.colours }
    : defaultLook();

  // Written in the person's own time zone and hour format (the top bar shows only the sign-in time, never a clock that would go stale).
  const zone = me.timeZone.effective ?? undefined;
  const hour12 = me.preferences?.hourFormat === "H12";
  const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12, timeZone: zone });
  const signedInTime = me.signedIn?.at ? clock(new Date(me.signedIn.at)) : null;
  const secondsLeft = me.session?.secondsLeft ?? null;
  const sessionLeft =
    secondsLeft === null
      ? null
      : secondsLeft >= 3600
        ? `${Math.floor(secondsLeft / 3600)} h ${Math.floor((secondsLeft % 3600) / 60)} min left`
        : `${Math.max(1, Math.floor(secondsLeft / 60))} min left`;

  // Reserved for V2 (support view): the service returns null until a support session is active.
  const support = me.supportView as { by: string; expiresAt: string } | null;

  const session = me.session
    ? {
        expiresAt: me.session.expiresAt,
        warnAt: new Date(Date.parse(me.generatedAt) + me.session.warnInSeconds * 1000).toISOString(),
        canExtend: me.session.canExtend,
      }
    : null;

  return (
    <ThemeProvider initialLook={look} initialDensity={me.preferences?.density}>
      <NoFlashScript />
      {/* The installable app (FIG-791, F4.12): this organisation's own manifest (its name and colours), read with the session cookie. */}
      <link rel="manifest" href={`/api/orgs/${orgSlug}/pwa/manifest`} crossOrigin="use-credentials" />
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <MemberProvider
        value={{
          orgSlug,
          membershipId: ctx.membershipId,
          userName: me.user.name,
          roleName: me.role?.name ?? "No role",
          permissionKeys: ctx.permissionKeys,
          timeZone: me.timeZone.effective,
          hour12: me.preferences?.hourFormat === "H12",
        }}
      >
      <AppShell
        orgSlug={orgSlug}
        sections={buildNav(navInput)}
        quickCreate={buildQuickCreate(navInput)}
        initialSidebarCollapsed={me.preferences?.sidebar.collapsed ?? false}
        session={session}
        search={<GlobalSearch />}
        bell={<NotificationBell />}
        organisationSwitcher={demoScreens ? <OrgSwitcher /> : undefined}
        banners={demoScreens ? <OrgBanners /> : undefined}
        identity={{
          name: me.user.name,
          email: me.user.email,
          roleName: me.role?.name ?? "No role",
          workspaceLabel: me.role?.workspaceLabel ?? null,
          logoUrl: me.organisation?.logoUrl ?? null,
          organisation: me.organisation?.shownName ?? me.organisation?.name ?? "",
          avatarUrl: me.membership?.avatar.url ?? null,
          signedInLocal: me.signedIn?.local ?? null,
          signedInTime,
          sessionLeft,
          device: me.signedIn?.device ?? null,
          place: me.signedIn?.place ?? null,
          timeZone: me.timeZone.effective,
          organisationTimeZone: me.timeZone.differsFromOrganisation ? me.timeZone.organisation : null,
          supportNotice: support ? `${support.by} is viewing this organisation (read-only) until ${new Date(support.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone })}.` : null,
          preferencesHref: `/o/${orgSlug}/preferences`,
        }}
      >
        {children}
      </AppShell>
      </MemberProvider>
    </ThemeProvider>
  );
}
