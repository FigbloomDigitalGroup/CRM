import "@/ui/ui.css";
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

  const navInput = { permissionKeys: ctx.permissionKeys, membershipId: ctx.membershipId, hidden: me.preferences?.sidebar.hidden ?? [] };
  const look: LookInput = me.look
    ? { locked: me.look.locked, toggle: me.look.toggle, colours: me.look.colours }
    : defaultLook();

  // Written in the person's own time zone; Intl does not reliably insert the weekday comma, so it is assembled by hand.
  const zone = me.timeZone.effective ?? undefined;
  const now = new Date();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: zone });
  const dayMonth = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: zone });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: me.preferences?.hourFormat === "H12", timeZone: zone });
  const dateLabel = `${weekday}, ${dayMonth} · ${time}`;

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
        dateLabel={dateLabel}
        initialSidebarCollapsed={me.preferences?.sidebar.collapsed ?? false}
        session={session}
        search={<GlobalSearch />}
        bell={<NotificationBell />}
        identity={{
          name: me.user.name,
          roleName: me.role?.name ?? "No role",
          organisation: me.organisation?.shownName ?? me.organisation?.name ?? "",
          avatarUrl: me.membership?.avatar.url ?? null,
          signedInLocal: me.signedIn?.local ?? null,
          device: me.signedIn?.device ?? null,
          place: me.signedIn?.place ?? null,
          timeZone: me.timeZone.effective,
          organisationTimeZone: me.timeZone.differsFromOrganisation ? me.timeZone.organisation : null,
          supportNotice: support ? `${support.by} is viewing this organisation (read-only) until ${new Date(support.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone })}.` : null,
          preferencesHref: `/o/${orgSlug}/settings`,
        }}
      >
        {children}
      </AppShell>
      </MemberProvider>
    </ThemeProvider>
  );
}
