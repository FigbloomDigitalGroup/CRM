import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { listActivitiesForCompany } from "@/services/activityService";
import { listAuditHistory } from "@/services/auditService";
import { getCompany, listAssignableCompanyOwners, listCompanies } from "@/services/companyService";
import { listCommunicationsForCompany } from "@/services/communicationService";
import { listCompanyServices } from "@/services/companyServiceLinkService";
import { listContacts } from "@/services/contactService";
import { recordPageView } from "@/services/pageViewService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { ActivityTimeline } from "../../_shared/ActivityTimeline";
import { ArchiveControl } from "../../_shared/ArchiveControl";
import { AuditHistory } from "../../_shared/AuditHistory";
import { CommunicationTimeline } from "../../_shared/CommunicationTimeline";
import { MergeControl } from "../../_shared/MergeControl";
import { OwnerChip } from "../../_shared/OwnerChip";
import { accountCapabilities } from "../../_shared/accountCapabilities";
import { IconShield } from "../../_shared/icons";
import { NoAccess } from "../../_shared/NoAccess";
import { TaskSection } from "../../_shared/TaskSection";
import { CompanyServicesSection } from "../CompanyServicesSection";
import { EditCompanyForm } from "./EditCompanyForm";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; companyId: string }>;
}) {
  const { orgSlug, companyId } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "companies_detail");

  let company;
  try {
    company = await getCompany(ctx, companyId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Companies" />;
    }
    throw err;
  }

  const contacts = hasPermission(ctx, "contacts.view")
    ? await listContacts(ctx, { companyId })
    : [];

  const referenceData = await getFormReferenceData(ctx);

  let activities: Awaited<ReturnType<typeof listActivitiesForCompany>> = [];
  try {
    activities = await listActivitiesForCompany(ctx, companyId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  try {
    tasks = await listTasks(ctx, { companyId });
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let auditEvents: Awaited<ReturnType<typeof listAuditHistory>> = [];
  try {
    auditEvents = await listAuditHistory(ctx, "Company", companyId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let companyServices: Awaited<ReturnType<typeof listCompanyServices>> = [];
  try {
    companyServices = await listCompanyServices(ctx, companyId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let communications: Awaited<ReturnType<typeof listCommunicationsForCompany>> = [];
  try {
    communications = await listCommunicationsForCompany(ctx, companyId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const caps = accountCapabilities(ctx, "companies", company);
  const owners = caps.canReassign
    ? await listAssignableCompanyOwners(ctx)
    : [];
  const ownerName = company.owner?.user.name ?? null;
  const canMerge = caps.canMerge;
  const mergeOptions = canMerge
    ? (await listCompanies(ctx))
        .filter((c) => c.id !== company.id && !c.archivedAt)
        .map((c) => ({ id: c.id, label: c.name }))
    : [];

  return (
    <div>
      <div className="detail-head">
        <div>
          <a className="detail-back" href={`/o/${orgSlug}/companies`}>
            &larr; Companies
          </a>
          <div className="detail-title">
            <h1>{company.name}</h1>
            {company.archivedAt && <span className="badge">Archived</span>}
            {company.lifecycleState && (
              <span className="badge badge-green">{company.lifecycleState.name}</span>
            )}
          </div>
          <div className="detail-meta">
            <span>Owner</span>
            <OwnerChip name={ownerName} />
            <span>Added {company.createdAt.toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {company.archivedAt && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>This company is archived.</strong> It is read-only until it
            is restored &mdash; no edits, new contacts or service changes.
          </p>
        </div>
      )}
      {!company.archivedAt && !hasPermission(ctx, "companies.edit") && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You can view this company but not change it.</strong>{" "}
            Editing is handled by the Sales and Management teams.
          </p>
        </div>
      )}

      <div className="card">
        <strong>Details</strong>
        <dl className="detail-grid">
          <div>
            <dt>Industry</dt>
            <dd>{company.industry ?? "--"}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{company.lifecycleState?.name ?? "--"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{company.email ?? "--"}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{company.phone ?? "--"}</dd>
          </div>
          <div>
            <dt>Website</dt>
            <dd>{company.website ?? "--"}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{company.location ?? "--"}</dd>
          </div>
          <div className="is-wide">
            <dt>Notes</dt>
            <dd>{company.notes ?? "--"}</dd>
          </div>
        </dl>
      </div>

      {caps.canEdit && (
        <div className="card">
          <strong>Edit company</strong>
          <EditCompanyForm
            orgSlug={orgSlug}
            company={{
              id: company.id,
              name: company.name,
              industry: company.industry,
              website: company.website,
              location: company.location,
              email: company.email,
              phone: company.phone,
              notes: company.notes,
              lifecycleStateId: company.lifecycleStateId,
              ownerMembershipId: company.ownerMembershipId,
            }}
            lifecycleStates={referenceData.lifecycleStates.map((s) => ({
              id: s.id,
              name: s.name,
            }))}
            owners={owners}
            ownerName={ownerName}
            canAssign={caps.canReassign}
          />
        </div>
      )}

      {hasPermission(ctx, "company_services.view") && (
        <CompanyServicesSection
          orgSlug={orgSlug}
          companyId={company.id}
          services={companyServices.map((s) => ({
            id: s.id,
            serviceId: s.serviceId,
            serviceName: s.service.name,
            status: s.status,
            startDate: s.startDate?.toISOString() ?? null,
            endDate: s.endDate?.toISOString() ?? null,
            notes: s.notes,
          }))}
          catalog={referenceData.services}
          canManage={hasPermission(ctx, "company_services.manage") && !company.archivedAt}
        />
      )}

      {hasPermission(ctx, "contacts.view") && (
        <>
          <h2>Contacts at this company</h2>
          <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Job title</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={`/o/${orgSlug}/contacts/${c.id}`}>
                      {c.firstName} {c.lastName ?? ""}
                    </a>
                  </td>
                  <td>{c.jobTitle ?? "--"}</td>
                  <td>{c.email ?? "--"}</td>
                  <td>{c.phone ?? "--"}</td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={4}>No contacts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </>
      )}

      {hasPermission(ctx, "activities.view") && (
        <ActivityTimeline
          orgSlug={orgSlug}
          parentField="companyId"
          parentId={company.id}
          activities={activities.map((a) => ({
            ...a,
            occurredAt: a.occurredAt.toISOString(),
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "activities.create")}
        />
      )}

      {(hasPermission(ctx, "tasks.view.own") || hasPermission(ctx, "tasks.view.all")) && (
        <TaskSection
          orgSlug={orgSlug}
          parentField="companyId"
          parentId={company.id}
          tasks={tasks.map((t) => ({
            ...t,
            dueAt: t.dueAt ? t.dueAt.toISOString() : null,
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "tasks.create")}
          canAssignAny={hasPermission(ctx, "tasks.assign.any")}
        />
      )}

      {hasPermission(ctx, "communications.view") && (
        <CommunicationTimeline
          orgSlug={orgSlug}
          parentField="companyId"
          parentId={company.id}
          communications={communications.map((c) => ({
            ...c,
            occurredAt: c.occurredAt.toISOString(),
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "communications.create")}
          defaultToEmail={company.email}
        />
      )}

      {hasPermission(ctx, "audit.view") && (
        <AuditHistory
          events={auditEvents.map((e) => ({
            ...e,
            createdAt: e.createdAt.toISOString(),
          }))}
          members={referenceData.members}
        />
      )}

      <MergeControl
        orgSlug={orgSlug}
        basePath={`companies/${company.id}`}
        bodyKey="intoCompanyId"
        options={mergeOptions}
        canMerge={canMerge}
      />

      <ArchiveControl
        orgSlug={orgSlug}
        basePath={`companies/${company.id}`}
        archivedAt={company.archivedAt?.toISOString() ?? null}
        canArchive={caps.canArchive || caps.canRestore}
      />
    </div>
  );
}
