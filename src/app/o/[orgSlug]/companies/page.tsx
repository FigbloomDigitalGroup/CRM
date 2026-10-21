import { canAssignAccountOwner, canWorkAccounts } from "@/auth/accountAccess";
import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listAssignableCompanyOwners, listCompanies } from "@/services/companyService";
import { recordPageView } from "@/services/pageViewService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { ImportCsvForm } from "@/components/ImportCsvForm";
import { FilterComboField } from "../leads/FilterComboField";
import { NoAccess } from "../_shared/NoAccess";
import { OwnerChip } from "../_shared/OwnerChip";
import { OwnerControl } from "../_shared/OwnerControl";
import { accountCapabilities, initialsFor } from "../_shared/accountCapabilities";
import { IconDownload, IconOpen, IconShield } from "../_shared/icons";
import { CompanyRefsProvider } from "./CompanyRefs";
import { CompanyRowActions } from "./CompanyRowActions";
import { CreateCompanyForm } from "./CreateCompanyForm";

const IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "industry", label: "Industry" },
  { key: "website", label: "Website" },
  { key: "location", label: "Location" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "notes", label: "Notes" },
  { key: "lifecycleState", label: "Lifecycle state (by name)" },
  { key: "ownerEmail", label: "Owner (by email)" },
];

type View = "all" | "mine" | "unowned" | "archived";

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    q?: string;
    lifecycleStateId?: string;
    ownerMembershipId?: string;
    view?: string;
    includeArchived?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { q, lifecycleStateId, ownerMembershipId, view: viewParam, includeArchived } =
    await searchParams;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "companies");

  // Restricted Technical has no companies.view at all, so this fails closed;
  // show an explanation (and the nearest page they can use), not an error.
  let allCompanies;
  try {
    allCompanies = await listCompanies(ctx, { includeArchived: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Companies" />;
    }
    throw err;
  }

  const canCreate = hasPermission(ctx, "companies.create");
  const canImport = hasPermission(ctx, "companies.import");
  const canEdit = hasPermission(ctx, "companies.edit");
  const canSeeContacts = hasPermission(ctx, "contacts.view");
  const canOwn = canWorkAccounts(ctx.permissionKeys, "companies");
  const canAssign = canAssignAccountOwner(ctx, "companies");

  const [referenceData, owners] = await Promise.all([
    getFormReferenceData(ctx),
    canAssign ? listAssignableCompanyOwners(ctx) : Promise.resolve([]),
  ]);

  const active = allCompanies.filter((c) => !c.archivedAt);
  const unowned = active.filter((c) => !c.ownerMembershipId);
  const mine = active.filter((c) => c.ownerMembershipId === ctx.membershipId);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = active.filter((c) => c.createdAt >= thirtyDaysAgo);

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "all", label: "All", count: active.length },
    ...(canOwn
      ? [{ key: "mine" as View, label: "My companies", count: mine.length }]
      : []),
    ...(canAssign
      ? [{ key: "unowned" as View, label: "Unassigned", count: unowned.length }]
      : []),
    {
      key: "archived",
      label: "Archived",
      count: allCompanies.length - active.length,
    },
  ];

  const requested: View | undefined =
    includeArchived === "true" ? "archived" : (viewParam as View | undefined);
  const view: View = tabs.some((t) => t.key === requested) ? (requested as View) : "all";

  const needle = q?.trim().toLowerCase() ?? "";
  const matchesFilters = (c: (typeof allCompanies)[number]) => {
    if (lifecycleStateId && c.lifecycleStateId !== lifecycleStateId) return false;
    if (ownerMembershipId && c.ownerMembershipId !== ownerMembershipId) return false;
    if (needle) {
      const hay = [c.name, c.email, c.phone, c.industry, c.website, c.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };

  const companies = allCompanies.filter((c) => {
    if (!matchesFilters(c)) return false;
    switch (view) {
      case "mine":
        return !c.archivedAt && c.ownerMembershipId === ctx.membershipId;
      case "unowned":
        return !c.archivedAt && !c.ownerMembershipId;
      case "archived":
        return Boolean(c.archivedAt);
      default:
        return !c.archivedAt;
    }
  });

  const tabHref = (key: View) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (lifecycleStateId) sp.set("lifecycleStateId", lifecycleStateId);
    if (ownerMembershipId) sp.set("ownerMembershipId", ownerMembershipId);
    if (key !== "all") sp.set("view", key);
    const qs = sp.toString();
    return `/o/${orgSlug}/companies${qs ? `?${qs}` : ""}`;
  };

  // Owner filter options come from who actually owns something here, so every
  // role (not just those who can list members) gets a working filter.
  const ownerFilter = new Map<string, string>();
  for (const c of allCompanies) {
    if (c.ownerMembershipId && c.owner) {
      ownerFilter.set(c.ownerMembershipId, c.owner.user.name);
    }
  }

  const exportQuery = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(lifecycleStateId ? { lifecycleStateId } : {}),
    ...(ownerMembershipId ? { ownerMembershipId } : {}),
  }).toString();

  const scopeText = canAssign
    ? "You can add, edit, reassign, merge, archive, import and export any company."
    : canEdit
      ? "You can add, edit, merge and archive companies."
      : "You can view companies.";

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <p className="who">Every organisation you work with, in one shared list.</p>
        </div>
        {hasPermission(ctx, "companies.export") && (
          <div className="page-head-actions">
            <a
              className="btn-ghost"
              href={`/api/orgs/${orgSlug}/companies/export${exportQuery ? `?${exportQuery}` : ""}`}
            >
              <IconDownload size={15} />
              Export CSV
            </a>
          </div>
        )}
      </div>

      <div className="list-meta">
        <div className="scope-line">
          <span className="scope-pill is-all">
            All organization companies &middot; {active.length}
          </span>
          <span className="scope-text">{scopeText}</span>
        </div>
      </div>

      {!canEdit && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You can view companies but not change them.</strong> Adding,
            editing and archiving companies is handled by the Sales and
            Management teams.
          </p>
        </div>
      )}
      {canEdit && !canAssign && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>Reassigning, importing and exporting companies is handled by
            Management.</strong> You can add and edit any company, merge
            duplicates and archive records.
          </p>
        </div>
      )}

      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-blue" />Companies</div>
              <div className="kpi-value">{active.length}</div>
              <div className="kpi-sub">
                {allCompanies.length - active.length} archived
              </div>
            </div>
            {canOwn ? (
              <div className="kpi-card">
                <div className="kpi-label"><span className="stage-dot tone-green" />Mine</div>
                <div className="kpi-value">{mine.length}</div>
                <div className="kpi-sub">companies you own</div>
              </div>
            ) : (
              <div className="kpi-card">
                <div className="kpi-label"><span className="stage-dot tone-purple" />Industries</div>
                <div className="kpi-value">
                  {new Set(active.map((c) => c.industry).filter(Boolean)).size}
                </div>
                <div className="kpi-sub">represented</div>
              </div>
            )}
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-orange" />Unassigned</div>
              <div className="kpi-value">{unowned.length}</div>
              <div className="kpi-sub">no owner yet</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-purple" />New</div>
              <div className="kpi-value">{recent.length}</div>
              <div className="kpi-sub">added in the last 30 days</div>
            </div>
          </div>

          <nav className="lead-tabs" aria-label="Company views">
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
              placeholder="Search name, email, phone, industry"
            />
            <FilterComboField
              name="lifecycleStateId"
              defaultValue={lifecycleStateId ?? ""}
              placeholder="Any lifecycle"
              options={[
                { value: "", label: "Any lifecycle" },
                ...referenceData.lifecycleStates.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <FilterComboField
              name="ownerMembershipId"
              defaultValue={ownerMembershipId ?? ""}
              placeholder="Any owner"
              options={[
                { value: "", label: "Any owner" },
                ...[...ownerFilter.entries()].map(([value, label]) => ({
                  value,
                  label,
                  avatarLabel: initialsFor(label),
                })),
              ]}
            />
            <button type="submit">Filter</button>
          </form>

          <CompanyRefsProvider
            refs={{
              lifecycleStates: referenceData.lifecycleStates.map((s) => ({
                id: s.id,
                name: s.name,
              })),
              owners,
            }}
          >
            <div className="card table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Industry</th>
                    <th>Lifecycle</th>
                    {canSeeContacts && <th>Contacts</th>}
                    <th>Owner</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    const caps = accountCapabilities(ctx, "companies", c);
                    const ownerName = c.owner?.user.name ?? null;
                    const sub = [c.email, c.phone].filter(Boolean).join(" · ");
                    return (
                      <tr key={c.id} className={c.archivedAt ? "is-archived" : undefined}>
                        <td>
                          <a className="cell-primary" href={`/o/${orgSlug}/companies/${c.id}`}>
                            {c.name}
                            <IconOpen className="cell-primary-icon" />
                          </a>
                          {c.archivedAt && <span className="badge"> Archived</span>}
                          {sub && <div className="cell-sub">{sub}</div>}
                        </td>
                        <td className="nowrap">{c.industry ?? "--"}</td>
                        <td className="nowrap">
                          {c.lifecycleState ? (
                            <span className="badge badge-green">{c.lifecycleState.name}</span>
                          ) : (
                            "--"
                          )}
                        </td>
                        {canSeeContacts && (
                          <td className="nowrap">{c._count.contacts}</td>
                        )}
                        <td>
                          {caps.canReassign ? (
                            <OwnerControl
                              orgSlug={orgSlug}
                              basePath={`companies/${c.id}`}
                              currentOwnerMembershipId={c.ownerMembershipId}
                              members={owners}
                              label="company"
                            />
                          ) : (
                            <OwnerChip name={ownerName} />
                          )}
                        </td>
                        <td className="actions-col">
                          <CompanyRowActions
                            orgSlug={orgSlug}
                            ownerName={ownerName}
                            caps={{
                              canEdit: caps.canEdit,
                              canArchive: caps.canArchive,
                              canRestore: caps.canRestore,
                              canMerge: caps.canMerge,
                              canReassign: caps.canReassign,
                              reassignLocked: caps.reassignLocked,
                            }}
                            company={{
                              id: c.id,
                              name: c.name,
                              industry: c.industry,
                              website: c.website,
                              location: c.location,
                              email: c.email,
                              phone: c.phone,
                              notes: c.notes,
                              lifecycleStateId: c.lifecycleStateId,
                              ownerMembershipId: c.ownerMembershipId,
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {companies.length === 0 && (
                    <tr>
                      <td colSpan={canSeeContacts ? 6 : 5}>
                        {view === "all" && !q && !lifecycleStateId && !ownerMembershipId
                          ? "No companies yet."
                          : "No companies match this view."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="table-foot">
                <span>
                  Showing {companies.length} compan{companies.length === 1 ? "y" : "ies"}
                </span>
                {view !== "archived" && (
                  <span>Archived companies are hidden &middot; open the Archived tab</span>
                )}
              </div>
            </div>
          </CompanyRefsProvider>
        </div>

        {(canCreate || canImport) && (
          <div className="list-with-side-rail">
            {canCreate && (
              <>
                <h2>New company</h2>
                <div className="card">
                  <CreateCompanyForm
                    orgSlug={orgSlug}
                    lifecycleStates={referenceData.lifecycleStates.map((s) => ({
                      id: s.id,
                      name: s.name,
                    }))}
                    owners={owners}
                    defaultOwnerMembershipId={ctx.membershipId}
                  />
                </div>
              </>
            )}

            {canImport && (
              <>
                <h2>Import companies from CSV</h2>
                <div className="card">
                  <ImportCsvForm
                    importUrl={`/api/orgs/${orgSlug}/companies/import`}
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
