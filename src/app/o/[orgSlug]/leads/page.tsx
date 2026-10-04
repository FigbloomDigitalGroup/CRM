import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { listLeads } from "@/services/leadService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { ImportCsvForm } from "@/components/ImportCsvForm";
import { CreateLeadForm } from "./CreateLeadForm";
import { AssignLeadControl } from "./AssignLeadControl";

const IMPORT_FIELDS = [
  { key: "leadStatus", label: "Lead status (by name)", required: true },
  { key: "company", label: "Company (by exact name)" },
  { key: "contactEmail", label: "Contact email" },
  { key: "contactPhone", label: "Contact phone" },
  { key: "leadSource", label: "Lead source (by name)" },
  { key: "temperature", label: "Temperature (HOT/WARM/COLD)" },
  { key: "serviceInterest", label: "Service interest (by name)" },
  { key: "ownerEmail", label: "Owner (by email)" },
  { key: "notes", label: "Notes" },
];

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    q?: string;
    leadStatusId?: string;
    temperature?: string;
    includeArchived?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { q, leadStatusId, temperature, includeArchived } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);

  // Delivery, Finance, and Restricted Technical have no leads.view.* at all,
  // so listLeads() fails closed rather than returning an empty list -- this
  // must be caught explicitly instead of crashing the page for those roles.
  let leads;
  try {
    leads = await listLeads(ctx, {
      query: q,
      leadStatusId,
      temperature: temperature as "HOT" | "WARM" | "COLD" | undefined,
      includeArchived: includeArchived === "true",
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <p className="error">Your role does not have access to Leads.</p>;
    }
    throw err;
  }

  const [referenceData, companies, contacts] = await Promise.all([
    getFormReferenceData(ctx),
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
  ]);

  const canAssign = hasPermission(ctx, "leads.assign");

  return (
    <div>
      <h1>Leads</h1>

      {hasPermission(ctx, "leads.export") && (
        <p>
          <a
            href={`/api/orgs/${orgSlug}/leads/export${
              q || leadStatusId
                ? `?${new URLSearchParams({
                    ...(q ? { q } : {}),
                    ...(leadStatusId ? { leadStatusId } : {}),
                  }).toString()}`
                : ""
            }`}
          >
            Export CSV
          </a>
        </p>
      )}

      <p className="who">
        {hasPermission(ctx, "leads.view.all")
          ? "Showing all organization leads (leads.view.all)."
          : "Showing only leads you own (leads.view.own) -- this is enforced server-side, not just hidden in the UI."}
      </p>

      <form className="filters" method="GET">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search notes, company, contact"
        />
        <select name="leadStatusId" defaultValue={leadStatusId ?? ""}>
          <option value="">Any status</option>
          {referenceData.leadStatuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="temperature" defaultValue={temperature ?? ""}>
          <option value="">Any temperature</option>
          <option value="HOT">Hot</option>
          <option value="WARM">Warm</option>
          <option value="COLD">Cold</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            name="includeArchived"
            value="true"
            defaultChecked={includeArchived === "true"}
          />
          Show archived
        </label>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>Company / Contact</th>
              <th>Status</th>
              <th>Temperature</th>
              <th>Source</th>
              <th>Owner</th>
              {canAssign && <th>Reassign</th>}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <a href={`/o/${orgSlug}/leads/${lead.id}`}>
                    {lead.company?.name ??
                      lead.contact?.firstName ??
                      "(no company/contact)"}
                  </a>
                  {lead.archivedAt && <span className="badge"> Archived</span>}
                </td>
                <td>{lead.leadStatus.name}</td>
                <td>
                  <span
                    className={`badge badge-${temperatureColor(lead.temperature)}`}
                  >
                    {lead.temperature}
                  </span>
                </td>
                <td>{lead.leadSource?.name ?? "--"}</td>
                <td>
                  {referenceData.members.find(
                    (m) => m.membershipId === lead.ownerMembershipId,
                  )?.userName ?? "--"}
                </td>
                {canAssign && (
                  <td>
                    <AssignLeadControl
                      orgSlug={orgSlug}
                      leadId={lead.id}
                      currentOwnerMembershipId={lead.ownerMembershipId}
                      members={referenceData.members}
                    />
                  </td>
                )}
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={canAssign ? 6 : 5}>No leads visible to you yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasPermission(ctx, "leads.create") && (
        <>
          <h2>New lead</h2>
          <div className="card">
            <CreateLeadForm
              orgSlug={orgSlug}
              leadStatuses={referenceData.leadStatuses}
              leadSources={referenceData.leadSources}
              companies={companies.map((c) => ({ id: c.id, name: c.name }))}
              contacts={contacts.map((c) => ({
                id: c.id,
                name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
              }))}
            />
          </div>
        </>
      )}

      {hasPermission(ctx, "leads.import") && (
        <>
          <h2>Import leads from CSV</h2>
          <div className="card">
            <ImportCsvForm
              importUrl={`/api/orgs/${orgSlug}/leads/import`}
              fields={IMPORT_FIELDS}
            />
          </div>
        </>
      )}
    </div>
  );
}

function temperatureColor(temperature: "HOT" | "WARM" | "COLD") {
  if (temperature === "HOT") return "red";
  if (temperature === "WARM") return "orange";
  return "blue";
}
