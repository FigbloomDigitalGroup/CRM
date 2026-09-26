import { hasPermission } from "@/auth/context";
import { resolveRequestContext } from "@/auth/requestContext";
import { getWebsiteIntegrationStatus } from "@/services/integrationService";
import { RegenerateWebsiteKeyButton } from "./RegenerateWebsiteKeyButton";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  if (!hasPermission(ctx, "configuration.manage")) {
    return <p className="error">Your role does not have access to Settings.</p>;
  }

  const status = await getWebsiteIntegrationStatus(ctx);

  return (
    <div>
      <h1>Settings</h1>

      <div className="card">
        <strong>Website lead capture</strong>
        <p className="who">
          Lets FigBloom&apos;s public website send form submissions straight
          into the CRM as leads. Submissions are auto-assigned to a sales rep
          in rotation and auto-stamped with source &quot;Website&quot; and the
          submission time (FIG-442).
        </p>

        {status.configured ? (
          <p>
            Key configured: <code>{status.keyPrefix}&hellip;</code>
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

        <RegenerateWebsiteKeyButton
          orgSlug={orgSlug}
          alreadyConfigured={status.configured}
        />

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
    </div>
  );
}
