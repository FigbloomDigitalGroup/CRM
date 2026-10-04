import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { listActivitiesForCompany } from "@/services/activityService";
import { listAuditHistory } from "@/services/auditService";
import { getCompany } from "@/services/companyService";
import { listCommunicationsForCompany } from "@/services/communicationService";
import { listCompanyServices } from "@/services/companyServiceLinkService";
import { listContacts } from "@/services/contactService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { ActivityTimeline } from "../../_shared/ActivityTimeline";
import { AuditHistory } from "../../_shared/AuditHistory";
import { CommunicationTimeline } from "../../_shared/CommunicationTimeline";
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

  let company;
  try {
    company = await getCompany(ctx, companyId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">Your role does not have access to Companies.</p>
      );
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

  return (
    <div>
      <p>
        <a href={`/o/${orgSlug}/companies`}>&larr; Companies</a>
      </p>
      <h1>{company.name}</h1>

      <div className="card">
        <p>Industry: {company.industry ?? "--"}</p>
        <p>Email: {company.email ?? "--"}</p>
        <p>Phone: {company.phone ?? "--"}</p>
        <p>Website: {company.website ?? "--"}</p>
        <p>Notes: {company.notes ?? "--"}</p>
      </div>

      {hasPermission(ctx, "companies.edit") && (
        <EditCompanyForm orgSlug={orgSlug} company={company} />
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
          canManage={hasPermission(ctx, "company_services.manage")}
        />
      )}

      {hasPermission(ctx, "contacts.view") && (
        <>
          <h2>Contacts at this company</h2>
          <table>
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
    </div>
  );
}
