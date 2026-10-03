import { hasPermission } from "@/auth/context";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminDb } from "@/db/adminClient";
import {
  getWebsiteIntegrationStatus,
  listRecentWebsiteActivity,
} from "@/services/integrationService";
import { listMemberships } from "@/services/membershipService";
import {
  getMyNotificationPreferences,
  getWebsiteAcknowledgementSetting,
} from "@/services/notificationService";
import { InviteMemberForm } from "./InviteMemberForm";
import { MembersTable } from "./MembersTable";
import { NotificationPreferencesForm } from "./NotificationPreferencesForm";
import { RegenerateWebsiteKeyButton } from "./RegenerateWebsiteKeyButton";
import { RevokeWebsiteKeyButton } from "./RevokeWebsiteKeyButton";
import { WebsiteAcknowledgementToggle } from "./WebsiteAcknowledgementToggle";
import { WebsiteSecuritySettingsForm } from "./WebsiteSecuritySettingsForm";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  const canManageIntegration = hasPermission(ctx, "configuration.manage");
  const canViewMembers = hasPermission(ctx, "membership.view");
  const canManageMembers = hasPermission(ctx, "membership.manage");
  const canAssignRole = hasPermission(ctx, "role.assign");

  return (
    <div>
      <h1>Settings</h1>

      <NotificationPreferencesSection ctx={ctx} orgSlug={orgSlug} />

      {canViewMembers && (
        <MembersSection
          orgSlug={orgSlug}
          canManageMembers={canManageMembers}
          canAssignRole={canAssignRole}
          ctx={ctx}
        />
      )}

      {canManageIntegration && <WebsiteIntegrationSection orgSlug={orgSlug} ctx={ctx} />}
    </div>
  );
}

/**
 * Self-service (FIG-597) -- every active member manages their own
 * notification preferences regardless of role, so this section is
 * deliberately not gated behind any permission check, unlike every other
 * section on this page.
 */
async function NotificationPreferencesSection({
  ctx,
  orgSlug,
}: {
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>;
  orgSlug: string;
}) {
  const preferences = await getMyNotificationPreferences(ctx);
  const rows = (Object.keys(preferences) as (keyof typeof preferences)[]).map((type) => ({
    type,
    ...preferences[type],
  }));

  return (
    <div className="card">
      <strong>Notification preferences</strong>
      <p className="who">
        Choose how you want to hear about things that need your attention.
      </p>
      <NotificationPreferencesForm orgSlug={orgSlug} preferences={rows} />
    </div>
  );
}

async function MembersSection({
  orgSlug,
  canManageMembers,
  canAssignRole,
  ctx,
}: {
  orgSlug: string;
  canManageMembers: boolean;
  canAssignRole: boolean;
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>;
}) {
  const [members, roles] = await Promise.all([
    listMemberships(ctx),
    adminDb.role.findMany({ orderBy: { name: "asc" } }),
  ]);

  const roleOptions = roles.map((r) => ({ key: r.key, name: r.name }));

  return (
    <div className="card">
      <strong>Members</strong>
      <p className="who">
        Invite people to this organization and manage their role and access.
      </p>

      <MembersTable
        orgSlug={orgSlug}
        members={members.map((m) => ({
          ...m,
          invitedAt: m.invitedAt?.toISOString() ?? null,
          joinedAt: m.joinedAt?.toISOString() ?? null,
        }))}
        roles={roleOptions}
        canAssignRole={canAssignRole}
        canManage={canManageMembers}
      />

      {canManageMembers && canAssignRole && (
        <>
          <h2>Invite a member</h2>
          <InviteMemberForm orgSlug={orgSlug} roles={roleOptions} />
        </>
      )}
    </div>
  );
}

async function WebsiteIntegrationSection({
  orgSlug,
  ctx,
}: {
  orgSlug: string;
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>;
}) {
  const [status, recentActivity, acknowledgement] = await Promise.all([
    getWebsiteIntegrationStatus(ctx),
    listRecentWebsiteActivity(ctx),
    hasPermission(ctx, "organization.manage_settings")
      ? getWebsiteAcknowledgementSetting(ctx)
      : Promise.resolve(null),
  ]);

  return (
    <div className="card">
      <strong>Website lead capture</strong>
      <p className="who">
        Lets FigBloom&apos;s public website send form submissions straight
        into the CRM as leads. Submissions are auto-assigned to a sales rep
        in rotation and auto-stamped with source &quot;Website&quot; and the
        submission time.
      </p>

      {status.configured ? (
        <p>
          Key configured: <code>{status.keyPrefix}&hellip;</code>
          {status.revoked && <span className="error"> (revoked)</span>}
          <br />
          Generated {new Date(status.createdAt).toLocaleString()}
          {status.lastUsedAt && (
            <>
              {" "}
              &middot; last used{" "}
              {new Date(status.lastUsedAt).toLocaleString()}
            </>
          )}
          {!status.lastUsedAt && <> &middot; not used yet</>}
        </p>
      ) : (
        <p className="who">No key generated yet -- the endpoint below will reject every request until one exists.</p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <RegenerateWebsiteKeyButton
          orgSlug={orgSlug}
          alreadyConfigured={status.configured}
        />
        {status.configured && !status.revoked && (
          <RevokeWebsiteKeyButton orgSlug={orgSlug} />
        )}
      </div>

      {status.configured && (
        <>
          <h2>Abuse protection</h2>
          <p className="who">
            Rate limiting and payload/field size limits always apply.
            Allowed origins, the honeypot field, and captcha are each
            optional and off unless configured here.
          </p>
          <WebsiteSecuritySettingsForm
            orgSlug={orgSlug}
            allowedOrigins={status.allowedOrigins}
            honeypotFieldName={status.honeypotFieldName}
            captchaConfigured={status.captchaConfigured}
          />

          {acknowledgement && (
            <>
              <h2>Enquirer acknowledgement</h2>
              <p className="who">
                Off by default. When enabled, anyone who submits the public
                form and gave an email address gets an automatic
                acknowledgement -- never a promise of a specific response
                time, just confirmation their message was received.
              </p>
              <WebsiteAcknowledgementToggle
                orgSlug={orgSlug}
                enabled={acknowledgement.enabled}
              />
            </>
          )}

          <h2>Recent activity</h2>
          <p className="who">
            Last {recentActivity.length} requests to the public endpoint,
            accepted or rejected.
          </p>
          {recentActivity.length === 0 ? (
            <p className="who">No requests yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Outcome</th>
                  <th>IP</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt.toLocaleString()}</td>
                    <td>{row.outcome}</td>
                    <td>{row.ipAddress ?? "—"}</td>
                    <td>{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <h2>Integration reference</h2>
      <p className="who">
        Hand this to whoever maintains the website. The key is a shared
        secret — it must be sent from the website&apos;s own backend, never
        from client-side/browser JavaScript.
      </p>
      <pre style={{ background: "var(--bg-page)", padding: 12, borderRadius: 8, fontSize: 12.5, overflowX: "auto" }}>
{`POST /api/public/orgs/${orgSlug}/leads
x-figbloom-api-key: <the generated key>
Content-Type: application/json

{
  "name": "Jane Doe",           // required
  "email": "jane@example.com",  // at least one of email/phone required
  "phone": "+254700000000",
  "company": "Example Ltd",     // optional
  "service": "CCTV",            // optional -- matched against the service catalog, best-effort
  "message": "Interested in a 4-camera install for our office.",
  "utm": { "utmSource": "google", "utmCampaign": "spring-promo" },
  "referrer": "https://figbloom.com/contact"
}`}
      </pre>
    </div>
  );
}
