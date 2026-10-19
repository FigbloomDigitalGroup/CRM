import { canAssignAccountOwner, canWorkAccounts } from "@/auth/accountAccess";
import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listAssignableContactOwners, listContacts } from "@/services/contactService";
import { recordPageView } from "@/services/pageViewService";
import { ImportCsvForm } from "@/components/ImportCsvForm";
import { FilterComboField } from "../leads/FilterComboField";
import { NoAccess } from "../_shared/NoAccess";
import { OwnerChip } from "../_shared/OwnerChip";
import { OwnerControl } from "../_shared/OwnerControl";
import { accountCapabilities, initialsFor } from "../_shared/accountCapabilities";
import { IconDownload, IconOpen, IconShield } from "../_shared/icons";
import { ContactRefsProvider } from "./ContactRefs";
import { ContactRowActions } from "./ContactRowActions";
import { CreateContactForm } from "./CreateContactForm";

const IMPORT_FIELDS = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name" },
  { key: "company", label: "Company (by exact name)" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "jobTitle", label: "Job title" },
  { key: "department", label: "Department" },
  { key: "notes", label: "Notes" },
  { key: "ownerEmail", label: "Owner (by email)" },
];

type View = "all" | "mine" | "standalone" | "archived";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    q?: string;
    companyId?: string;
    ownerMembershipId?: string;
    view?: string;
    includeArchived?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { q, companyId, ownerMembershipId, view: viewParam, includeArchived } =
    await searchParams;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "contacts");

  // Restricted Technical has no contacts.view at all, so this fails closed;
  // show an explanation (and the nearest page they can use), not an error.
  let allContacts;
  try {
    allContacts = await listContacts(ctx, { includeArchived: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Contacts" />;
    }
    throw err;
  }

  const canCreate = hasPermission(ctx, "contacts.create");
  const canImport = hasPermission(ctx, "contacts.import");
  const canEdit = hasPermission(ctx, "contacts.edit");
  const canOwn = canWorkAccounts(ctx.permissionKeys, "contacts");
  const canAssign = canAssignAccountOwner(ctx, "contacts");

  const [companyList, owners] = await Promise.all([
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    canAssign ? listAssignableContactOwners(ctx) : Promise.resolve([]),
  ]);

  const active = allContacts.filter((c) => !c.archivedAt);
  const mine = active.filter((c) => c.ownerMembershipId === ctx.membershipId);
  const standalone = active.filter((c) => !c.companyId);
  const noEmail = active.filter((c) => !c.email);

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "all", label: "All", count: active.length },
    ...(canOwn
      ? [{ key: "mine" as View, label: "My contacts", count: mine.length }]
      : []),
    { key: "standalone", label: "No company", count: standalone.length },
    {
      key: "archived",
      label: "Archived",
      count: allContacts.length - active.length,
    },
  ];

  const requested: View | undefined =
    includeArchived === "true" ? "archived" : (viewParam as View | undefined);
  const view: View = tabs.some((t) => t.key === requested) ? (requested as View) : "all";

  const needle = q?.trim().toLowerCase() ?? "";
  const matchesFilters = (c: (typeof allContacts)[number]) => {
    if (companyId && c.companyId !== companyId) return false;
    if (ownerMembershipId && c.ownerMembershipId !== ownerMembershipId) return false;
    if (needle) {
      const hay = [
        c.firstName,
        c.lastName,
        c.email,
        c.phone,
        c.jobTitle,
        c.department,
        c.company?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };

  const contacts = allContacts.filter((c) => {
    if (!matchesFilters(c)) return false;
    switch (view) {
      case "mine":
        return !c.archivedAt && c.ownerMembershipId === ctx.membershipId;
      case "standalone":
        return !c.archivedAt && !c.companyId;
      case "archived":
        return Boolean(c.archivedAt);
      default:
        return !c.archivedAt;
    }
  });

  const tabHref = (key: View) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (companyId) sp.set("companyId", companyId);
    if (ownerMembershipId) sp.set("ownerMembershipId", ownerMembershipId);
    if (key !== "all") sp.set("view", key);
    const qs = sp.toString();
    return `/o/${orgSlug}/contacts${qs ? `?${qs}` : ""}`;
  };

  // Filter options come from what is actually in the list, so every role
  // (not just those who can list members or companies) gets a working filter.
  const companyFilter = new Map<string, string>();
  const ownerFilter = new Map<string, string>();
  for (const c of allContacts) {
    if (c.companyId && c.company) companyFilter.set(c.companyId, c.company.name);
    if (c.ownerMembershipId && c.owner) {
      ownerFilter.set(c.ownerMembershipId, c.owner.user.name);
    }
  }
  const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);

  const exportQuery = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(companyId ? { companyId } : {}),
    ...(ownerMembershipId ? { ownerMembershipId } : {}),
  }).toString();

  const scopeText = canAssign
    ? "You can add, edit, reassign, merge, archive, import and export any contact."
    : canEdit
      ? "You can add, edit, merge and archive contacts."
      : "You can view contacts.";

  const companiesRepresented = new Set(active.map((c) => c.companyId).filter(Boolean)).size;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="who">The people you work with, in one shared list.</p>
        </div>
        {hasPermission(ctx, "contacts.export") && (
          <div className="page-head-actions">
            <a
              className="btn-ghost"
              href={`/api/orgs/${orgSlug}/contacts/export${exportQuery ? `?${exportQuery}` : ""}`}
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
            All organization contacts &middot; {active.length}
          </span>
          <span className="scope-text">{scopeText}</span>
        </div>
      </div>

      {!canEdit && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You can view contacts but not change them.</strong> Adding,
            editing and archiving contacts is handled by the Sales and
            Management teams.
          </p>
        </div>
      )}
      {canEdit && !canAssign && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>Reassigning, importing and exporting contacts is handled by
            Management.</strong> You can add and edit any contact, merge
            duplicates and archive records.
          </p>
        </div>
      )}

      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-blue" />Contacts</div>
              <div className="kpi-value">{active.length}</div>
              <div className="kpi-sub">
                {allContacts.length - active.length} archived
              </div>
            </div>
            {canOwn ? (
              <div className="kpi-card">
                <div className="kpi-label"><span className="stage-dot tone-green" />Mine</div>
                <div className="kpi-value">{mine.length}</div>
                <div className="kpi-sub">contacts you own</div>
              </div>
            ) : (
              <div className="kpi-card">
                <div className="kpi-label"><span className="stage-dot tone-green" />Companies</div>
                <div className="kpi-value">{companiesRepresented}</div>
                <div className="kpi-sub">represented</div>
              </div>
            )}
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-orange" />No company</div>
              <div className="kpi-value">{standalone.length}</div>
              <div className="kpi-sub">standalone contacts</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-purple" />Missing email</div>
              <div className="kpi-value">{noEmail.length}</div>
              <div className="kpi-sub">can&rsquo;t be emailed yet</div>
            </div>
          </div>

          <nav className="lead-tabs" aria-label="Contact views">
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
              placeholder="Search name, email, phone, company"
            />
            <FilterComboField
              name="companyId"
              defaultValue={companyId ?? ""}
              placeholder="Any company"
              options={[
                { value: "", label: "Any company" },
                ...[...companyFilter.entries()]
                  .sort(byLabel)
                  .map(([value, label]) => ({ value, label })),
              ]}
            />
            <FilterComboField
              name="ownerMembershipId"
              defaultValue={ownerMembershipId ?? ""}
              placeholder="Any owner"
              options={[
                { value: "", label: "Any owner" },
                ...[...ownerFilter.entries()].sort(byLabel).map(([value, label]) => ({
                  value,
                  label,
                  avatarLabel: initialsFor(label),
                })),
              ]}
            />
            <button type="submit">Filter</button>
          </form>

          <ContactRefsProvider
            refs={{
              companies: companyList.map((c) => ({ id: c.id, name: c.name })),
              owners,
            }}
          >
            <div className="card table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Company</th>
                    <th>Email / phone</th>
                    <th>Owner</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => {
                    const caps = accountCapabilities(ctx, "contacts", c);
                    const ownerName = c.owner?.user.name ?? null;
                    const fullName = `${c.firstName} ${c.lastName ?? ""}`.trim();
                    const sub = [c.jobTitle, c.department].filter(Boolean).join(" · ");
                    return (
                      <tr key={c.id} className={c.archivedAt ? "is-archived" : undefined}>
                        <td>
                          <a className="cell-primary" href={`/o/${orgSlug}/contacts/${c.id}`}>
                            {fullName}
                            <IconOpen className="cell-primary-icon" />
                          </a>
                          {c.archivedAt && <span className="badge"> Archived</span>}
                          {sub && <div className="cell-sub">{sub}</div>}
                        </td>
                        <td>
                          {c.company ? (
                            hasPermission(ctx, "companies.view") ? (
                              <a href={`/o/${orgSlug}/companies/${c.company.id}`}>
                                {c.company.name}
                              </a>
                            ) : (
                              c.company.name
                            )
                          ) : (
                            <span className="muted">No company</span>
                          )}
                        </td>
                        <td>
                          <div>{c.email ?? "--"}</div>
                          {c.phone && <div className="cell-sub">{c.phone}</div>}
                        </td>
                        <td>
                          {caps.canReassign ? (
                            <OwnerControl
                              orgSlug={orgSlug}
                              basePath={`contacts/${c.id}`}
                              currentOwnerMembershipId={c.ownerMembershipId}
                              members={owners}
                              label="contact"
                            />
                          ) : (
                            <OwnerChip name={ownerName} />
                          )}
                        </td>
                        <td className="actions-col">
                          <ContactRowActions
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
                            contact={{
                              id: c.id,
                              firstName: c.firstName,
                              lastName: c.lastName,
                              jobTitle: c.jobTitle,
                              department: c.department,
                              email: c.email,
                              phone: c.phone,
                              notes: c.notes,
                              companyId: c.companyId,
                              companyName: c.company?.name ?? null,
                              ownerMembershipId: c.ownerMembershipId,
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {contacts.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        {view === "all" && !q && !companyId && !ownerMembershipId
                          ? "No contacts yet."
                          : "No contacts match this view."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="table-foot">
                <span>
                  Showing {contacts.length} contact{contacts.length === 1 ? "" : "s"}
                </span>
                {view !== "archived" && (
                  <span>Archived contacts are hidden &middot; open the Archived tab</span>
                )}
              </div>
            </div>
          </ContactRefsProvider>
        </div>

        {(canCreate || canImport) && (
          <div className="list-with-side-rail">
            {canCreate && (
              <>
                <h2>New contact</h2>
                <div className="card">
                  <CreateContactForm
                    orgSlug={orgSlug}
                    companies={companyList.map((c) => ({ id: c.id, name: c.name }))}
                    owners={owners}
                    defaultOwnerMembershipId={ctx.membershipId}
                  />
                </div>
              </>
            )}

            {canImport && (
              <>
                <h2>Import contacts from CSV</h2>
                <div className="card">
                  <ImportCsvForm
                    importUrl={`/api/orgs/${orgSlug}/contacts/import`}
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
