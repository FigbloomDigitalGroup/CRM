import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminDb } from "@/db/adminClient";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { listAssignableLeadOwners, listLeads } from "@/services/leadService";
import { recordPageView } from "@/services/pageViewService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { IconDownload, IconOpen, IconShield } from "../_shared/icons";
import { ImportCsvForm } from "@/components/ImportCsvForm";
import { CreateLeadForm } from "./CreateLeadForm";
import { AssignLeadControl } from "./AssignLeadControl";
import { FilterComboField } from "./FilterComboField";
import { LeadRefsProvider } from "./LeadRefs";
import { LeadRowActions } from "./LeadRowActions";
import { NoAccess } from "../_shared/NoAccess";
import { leadCapabilities } from "./leadCapabilities";

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

type View = "all" | "hot" | "unassigned" | "followup" | "converted" | "archived";

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    q?: string;
    leadStatusId?: string;
    temperature?: string;
    ownerMembershipId?: string;
    view?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { q, leadStatusId, temperature, ownerMembershipId, view: viewParam } =
    await searchParams;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "leads");

  const canViewAll = hasPermission(ctx, "leads.view.all");

  // Delivery, Finance, and Restricted Technical have no leads.view.* at all,
  // so listLeads() fails closed rather than returning an empty list. Show
  // them an explanation (and the nearest page they can use) instead of an
  // error.
  let allLeads;
  try {
    allLeads = await listLeads(ctx, {
      query: q,
      leadStatusId,
      temperature: temperature as "HOT" | "WARM" | "COLD" | undefined,
      ownerMembershipId: canViewAll ? ownerMembershipId || undefined : undefined,
      // Fetched once with archived included so the tab counts are honest;
      // the view below decides what is actually listed.
      includeArchived: true,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Leads" />;
    }
    throw err;
  }

  const canAssign = hasPermission(ctx, "leads.assign");

  const [referenceData, companies, contacts, owners, me] = await Promise.all([
    getFormReferenceData(ctx),
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
    // Only people who can actually work leads are offered as owners.
    canAssign ? listAssignableLeadOwners(ctx) : Promise.resolve([]),
    adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } }),
  ]);

  const now = new Date();
  const isActive = (l: (typeof allLeads)[number]) => !l.archivedAt;
  const isFollowUpDue = (l: (typeof allLeads)[number]) =>
    isActive(l) && !l.convertedAt && l.nextFollowUpAt !== null && l.nextFollowUpAt <= now;

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "all", label: "All", count: allLeads.filter(isActive).length },
    {
      key: "hot",
      label: "Hot",
      count: allLeads.filter((l) => isActive(l) && l.temperature === "HOT").length,
    },
    canAssign
      ? {
          key: "unassigned",
          label: "Unassigned",
          count: allLeads.filter((l) => isActive(l) && !l.ownerMembershipId).length,
        }
      : {
          key: "followup",
          label: "Follow-up due",
          count: allLeads.filter(isFollowUpDue).length,
        },
    {
      key: "converted",
      label: "Converted",
      count: allLeads.filter((l) => isActive(l) && l.convertedAt).length,
    },
    {
      key: "archived",
      label: "Archived",
      count: allLeads.filter((l) => l.archivedAt).length,
    },
  ];

  const view: View = tabs.some((t) => t.key === viewParam)
    ? (viewParam as View)
    : "all";

  const leads = allLeads.filter((l) => {
    switch (view) {
      case "hot":
        return isActive(l) && l.temperature === "HOT";
      case "unassigned":
        return isActive(l) && !l.ownerMembershipId;
      case "followup":
        return isFollowUpDue(l);
      case "converted":
        return isActive(l) && Boolean(l.convertedAt);
      case "archived":
        return Boolean(l.archivedAt);
      default:
        return isActive(l);
    }
  });

  const tabHref = (key: View) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (leadStatusId) sp.set("leadStatusId", leadStatusId);
    if (temperature) sp.set("temperature", temperature);
    if (ownerMembershipId && canViewAll) sp.set("ownerMembershipId", ownerMembershipId);
    if (key !== "all") sp.set("view", key);
    const qs = sp.toString();
    return `/o/${orgSlug}/leads${qs ? `?${qs}` : ""}`;
  };

  const ownerNameFor = (id: string | null): string | null => {
    if (!id) return null;
    if (id === ctx.membershipId) return me.name;
    return (
      referenceData.members.find((m) => m.membershipId === id)?.userName ?? null
    );
  };

  const canCreate = hasPermission(ctx, "leads.create");
  const canImport = hasPermission(ctx, "leads.import");
  const visibleCount = allLeads.filter(isActive).length;

  return (
    <div>
      <h1>Leads</h1>

      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="list-meta">
            <div className="scope-line">
              <span className={`scope-pill ${canViewAll ? "is-all" : "is-own"}`}>
                {canViewAll ? "All organization leads" : "My leads"} &middot; {visibleCount}
              </span>
              <span className="scope-text">
                {canViewAll
                  ? "You can edit, reassign, convert and archive any lead."
                  : "Leads you own."}
              </span>
            </div>
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

          {!canViewAll && (
            <div className="scope-notice">
              <IconShield />
              <p>
                <strong>You&rsquo;re viewing only the leads you own.</strong> You
                can edit details, convert and archive them. Reassigning,
                importing and exporting leads is handled by Management.
              </p>
            </div>
          )}

          <nav className="lead-tabs" aria-label="Lead views">
            {tabs.map((t) => (
              <a
                key={t.key}
                href={tabHref(t.key)}
                className={`lead-tab${view === t.key ? " is-active" : ""}`}
                aria-current={view === t.key ? "page" : undefined}
              >
                {t.label}
                <span className="lead-tab-count">{t.count}</span>
              </a>
            ))}
          </nav>

          <form className="filters filters-bar" method="GET">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
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
            {canViewAll && (
              <FilterComboField
                name="ownerMembershipId"
                defaultValue={ownerMembershipId ?? ""}
                placeholder="Any owner"
                options={[
                  { value: "", label: "Any owner" },
                  ...owners.map((m) => ({
                    value: m.membershipId,
                    label: m.userName,
                    sublabel: m.roleName,
                    avatarLabel: initialsFor(m.userName),
                  })),
                ]}
              />
            )}
            <button type="submit">Filter</button>
          </form>

          <LeadRefsProvider
            refs={{
              leadStatuses: referenceData.leadStatuses.map((s) => ({
                id: s.id,
                name: s.name,
                key: s.key,
              })),
              leadSources: referenceData.leadSources.map((s) => ({ id: s.id, name: s.name })),
              lostReasons: referenceData.lostReasons.map((r) => ({ id: r.id, name: r.name })),
              owners,
            }}
          >
            <div className="card table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company / Contact</th>
                    <th>Status</th>
                    <th>Temperature</th>
                    <th>Source</th>
                    <th>Owner</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const caps = leadCapabilities(ctx, lead);
                    const ownerName = ownerNameFor(lead.ownerMembershipId);
                    const title =
                      lead.company?.name ?? lead.contact?.firstName ?? "(no company/contact)";
                    return (
                      <tr key={lead.id} className={lead.archivedAt ? "is-archived" : undefined}>
                        <td>
                          <a className="cell-primary" href={`/o/${orgSlug}/leads/${lead.id}`}>
                            {title}
                            <IconOpen className="cell-primary-icon" />
                          </a>
                          {lead.archivedAt && <span className="badge"> Archived</span>}
                          {lead.convertedAt && !lead.archivedAt && (
                            <span className="badge"> Converted</span>
                          )}
                        </td>
                        <td className="nowrap">{lead.leadStatus.name}</td>
                        <td className="nowrap">
                          <span className={`badge badge-${temperatureColor(lead.temperature)}`}>
                            {lead.temperature}
                          </span>
                        </td>
                        <td className="nowrap">{lead.leadSource?.name ?? "--"}</td>
                        <td>
                          {caps.canReassign ? (
                            <AssignLeadControl
                              orgSlug={orgSlug}
                              leadId={lead.id}
                              currentOwnerMembershipId={lead.ownerMembershipId}
                              members={owners}
                            />
                          ) : ownerName ? (
                            <span className="owner-chip">
                              <span className="owner-chip-avatar">{initialsFor(ownerName)}</span>
                              {ownerName}
                            </span>
                          ) : (
                            <span className="owner-chip is-unassigned">Unassigned</span>
                          )}
                        </td>
                        <td className="actions-col">
                          <LeadRowActions
                            orgSlug={orgSlug}
                            title={title}
                            ownerName={ownerName}
                            caps={{
                              canEdit: caps.canEdit,
                              canConvert: caps.canConvert,
                              canArchive: caps.canArchive,
                              canRestore: caps.canRestore,
                              canReassign: caps.canReassign,
                              reassignLocked: caps.reassignLocked,
                            }}
                            lead={{
                              id: lead.id,
                              leadStatusId: lead.leadStatusId,
                              leadSourceId: lead.leadSourceId,
                              temperature: lead.temperature,
                              notes: lead.notes,
                              nextFollowUpAt: lead.nextFollowUpAt
                                ? lead.nextFollowUpAt.toISOString().slice(0, 16)
                                : "",
                              lostReasonId: lead.lostReasonId,
                              ownerMembershipId: lead.ownerMembershipId,
                              converted: Boolean(lead.convertedAt),
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        {view === "all" && !q && !leadStatusId && !temperature
                          ? "No leads visible to you yet."
                          : "No leads match this view."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="table-foot">
                <span>
                  Showing {leads.length} lead{leads.length === 1 ? "" : "s"}
                </span>
                {view !== "archived" && (
                  <span>Archived leads are hidden &middot; open the Archived tab</span>
                )}
              </div>
            </div>
          </LeadRefsProvider>
        </div>

        {(canCreate || canImport) && (
          <div className="list-with-side-rail">
            {canCreate && (
              <>
                <h2>New lead</h2>
                <div className="card">
                  <CreateLeadForm
                    orgSlug={orgSlug}
                    leadStatuses={referenceData.leadStatuses.filter((s) => s.key !== "CONVERTED")}
                    leadSources={referenceData.leadSources}
                    companies={companies.map((c) => ({ id: c.id, name: c.name }))}
                    contacts={contacts.map((c) => ({
                      id: c.id,
                      name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
                    }))}
                    owners={owners}
                    defaultOwnerMembershipId={ctx.membershipId}
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
