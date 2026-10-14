import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { listLeads } from "@/services/leadService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { IconDownload } from "../_shared/icons";
import { ImportCsvForm } from "@/components/ImportCsvForm";
import { CreateLeadForm } from "./CreateLeadForm";
import { AssignLeadControl } from "./AssignLeadControl";
import { FilterComboField } from "./FilterComboField";

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

  const canCreate = hasPermission(ctx, "leads.create");
  const canImport = hasPermission(ctx, "leads.import");

  return (
    <div>
      <h1>Leads</h1>

      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="list-meta">
            <p className="who">
              {hasPermission(ctx, "leads.view.all")
                ? "Showing all organization leads (leads.view.all)."
                : "Showing only leads you own (leads.view.own) -- this is enforced server-side, not just hidden in the UI."}
            </p>
            {hasPermission(ctx, "leads.export") && (
              <a
                className="btn-ghost"
                href={`/api/orgs/${orgSlug}/leads/export${
                  q || leadStatusId
                    ? `?${new URLSearchParams({
                        ...(q ? { q } : {}),
                        ...(leadStatusId ? { leadStatusId } : {}),
                      }).toString()}`
                    : ""
                }`}
              >
                <IconDownload size={15} />
                Export CSV
              </a>
            )}
          </div>

          <form className="filters filters-bar" method="GET">
            <input
              className="filter-search"
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search notes, company, contact"
            />
            <FilterComboField
              name="leadStatusId"
              defaultValue={leadStatusId ?? ""}
              placeholder="Any status"
              options={[
                { value: "", label: "Any status" },
                ...referenceData.leadStatuses.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <FilterComboField
              name="temperature"
              defaultValue={temperature ?? ""}
              placeholder="Any temperature"
              options={[
                { value: "", label: "Any temperature" },
                { value: "HOT", label: "Hot" },
                { value: "WARM", label: "Warm" },
                { value: "COLD", label: "Cold" },
              ]}
            />
            <label className="check-pill">
              <input
                type="checkbox"
                name="includeArchived"
                value="true"
                defaultChecked={includeArchived === "true"}
              />
              Show archived
            </label>
            <button type="submit">
              Filter
            </button>
          </form>

          <div className="card table-card">
            <table className="data-table">
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
                      <a
                        className="cell-primary"
                        href={`/o/${orgSlug}/leads/${lead.id}`}
                      >
                        {lead.company?.name ??
                          lead.contact?.firstName ??
                          "(no company/contact)"}
                      </a>
                      {lead.archivedAt && <span className="badge"> Archived</span>}
                    </td>
                    <td className="nowrap">{lead.leadStatus.name}</td>
                    <td className="nowrap">
                      <span
                        className={`badge badge-${temperatureColor(lead.temperature)}`}
                      >
                        {lead.temperature}
                      </span>
                    </td>
                    <td className="nowrap">{lead.leadSource?.name ?? "--"}</td>
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
        </div>

        {(canCreate || canImport) && (
          <div className="list-with-side-rail">
            {canCreate && (
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

            {canImport && (
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
        )}
      </div>
    </div>
  );
}

function temperatureColor(temperature: "HOT" | "WARM" | "COLD") {
  if (temperature === "HOT") return "red";
  if (temperature === "WARM") return "orange";
  return "blue";
}
