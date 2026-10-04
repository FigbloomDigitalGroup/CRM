import { hasPermission } from "@/auth/context";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminDb } from "@/db/adminClient";
import {
  getInboundEmailIntegrationStatus,
  getWebsiteAssignmentSetting,
  getWebsiteIntegrationStatus,
  listRecentWebsiteActivity,
} from "@/services/integrationService";
import { listMemberships } from "@/services/membershipService";
import {
  getMyNotificationPreferences,
  getWebsiteAcknowledgementSetting,
} from "@/services/notificationService";
import { listCatalog } from "@/services/referenceCatalogService";
import { CatalogEditor } from "./CatalogEditor";
import { InviteMemberForm } from "./InviteMemberForm";
import { MembersTable } from "./MembersTable";
import { NotificationPreferencesForm } from "./NotificationPreferencesForm";
import { RegenerateInboundEmailKeyButton } from "./RegenerateInboundEmailKeyButton";
import { RegenerateWebsiteKeyButton } from "./RegenerateWebsiteKeyButton";
import { RevokeInboundEmailKeyButton } from "./RevokeInboundEmailKeyButton";
import { RevokeWebsiteKeyButton } from "./RevokeWebsiteKeyButton";
import { WebsiteAcknowledgementToggle } from "./WebsiteAcknowledgementToggle";
import { WebsiteAssignmentModeToggle } from "./WebsiteAssignmentModeToggle";
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
      {canManageIntegration && <InboundEmailSection orgSlug={orgSlug} ctx={ctx} />}
      {canManageIntegration && <ReferenceDataSection orgSlug={orgSlug} ctx={ctx} />}
    </div>
  );
}

/**
 * Add/rename/reorder/deactivate for the 5 organization-configurable
 * catalogs (FIG-599). CustomerLifecycleState is the same shape but out of
 * this ticket's scope, so it's left read-only/seed-only for now.
 */
async function ReferenceDataSection({
  orgSlug,
  ctx,
}: {
  orgSlug: string;
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>;
}) {
  const [leadSources, leadStatuses, pipelineStages, lostReasons, services] = await Promise.all([
    listCatalog(ctx, "leadSources"),
    listCatalog(ctx, "leadStatuses"),
    listCatalog(ctx, "pipelineStages"),
    listCatalog(ctx, "lostReasons"),
    listCatalog(ctx, "services"),
  ]);

  return (
    <div>
      <h2>Reference data</h2>
      <p className="who">
        Controlled values used across leads, deals, and companies. Deactivating a value hides it
        from new records but never touches records that already use it.
      </p>
      <CatalogEditor
        orgSlug={orgSlug}
        catalogKey="pipelineStages"
        label="Pipeline stages"
        entries={pipelineStages}
        variant="pipelineStage"
      />
      <CatalogEditor
        orgSlug={orgSlug}
        catalogKey="leadSources"
        label="Lead sources"
        entries={leadSources}
        variant="plain"
      />
      <CatalogEditor
        orgSlug={orgSlug}
        catalogKey="leadStatuses"
        label="Lead statuses"
        entries={leadStatuses}
        variant="plain"
      />
      <CatalogEditor
        orgSlug={orgSlug}
        catalogKey="lostReasons"
        label="Lost reasons"
        entries={lostReasons}
        variant="plain"
      />
      <CatalogEditor
        orgSlug={orgSlug}
        catalogKey="services"
        label="Services"
        entries={services}
        variant="service"
      />
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
  const [status, recentActivity, acknowledgement, assignment] = await Promise.all([
    getWebsiteIntegrationStatus(ctx),
    listRecentWebsiteActivity(ctx),
    hasPermission(ctx, "organization.manage_settings")
      ? getWebsiteAcknowledgementSetting(ctx)
      : Promise.resolve(null),
    getWebsiteAssignmentSetting(ctx),
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
          <h2>Lead assignment</h2>
          <p className="who">
            How a new website lead gets an owner. Round-robin cycles across active sales reps;
            unassigned leaves every new lead for someone to pick up manually.
          </p>
          <WebsiteAssignmentModeToggle orgSlug={orgSlug} mode={assignment.mode} />

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

/**
 * The "BCC-to-CRM" half of FIG-598's "mailbox sync or BCC-to-CRM" --
 * provisions the per-organization token a real inbound-email provider
 * (Postmark/Mailgun/SendGrid inbound parse) would be configured to send to.
 * No such provider account exists for this project -- see
 * `docs/DEPLOYMENT.md` -- so this section always shows the integration
 * reference even with nothing configured yet.
 */
async function InboundEmailSection({
  orgSlug,
  ctx,
}: {
  orgSlug: string;
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>;
}) {
  const status = await getInboundEmailIntegrationStatus(ctx);

  return (
    <div className="card">
      <strong>Inbound email (log emails sent outside the CRM)</strong>
      <p className="who">
        Lets a real inbound-email provider notify the CRM when someone
        emails a contact back -- "BCC-to-CRM" rather than a full mailbox
        sync. Matched to an existing contact by sender email and logged on
        their timeline; a sender with no matching contact is simply not
        logged.
      </p>

      {status.configured ? (
        <p>
          Token configured: <code>{status.keyPrefix}&hellip;</code>
          {status.revoked && <span className="error"> (revoked)</span>}
          <br />
          Generated {new Date(status.createdAt).toLocaleString()}
          {status.lastUsedAt && (
            <>
              {" "}
              &middot; last used {new Date(status.lastUsedAt).toLocaleString()}
            </>
          )}
          {!status.lastUsedAt && <> &middot; not used yet</>}
        </p>
      ) : (
        <p className="who">No token generated yet.</p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <RegenerateInboundEmailKeyButton
          orgSlug={orgSlug}
          alreadyConfigured={status.configured}
        />
        {status.configured && !status.revoked && (
          <RevokeInboundEmailKeyButton orgSlug={orgSlug} />
        )}
      </div>

      <h2>Integration reference</h2>
      <p className="who">
        Configure your inbound-email provider&apos;s webhook to POST here,
        with the token in the URL. No provider account exists for this
        project yet -- wiring one up (Postmark/Mailgun/SendGrid inbound
        parse, plus the DNS/MX changes it requires) is a deliberate next
        step, not built here.
      </p>
      <pre style={{ background: "var(--bg-page)", padding: 12, borderRadius: 8, fontSize: 12.5, overflowX: "auto" }}>
{`POST /api/public/orgs/${orgSlug}/communications/inbound?token=<the generated token>
Content-Type: application/json

{
  "from": "jane@example.com",   // required -- matched against an existing contact's email
  "subject": "Re: your proposal",
  "text": "Thanks, this looks great.",
  "messageId": "<provider-specific message id>"
}`}
      </pre>
    </div>
  );
}
