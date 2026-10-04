import { notFound } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listActivitiesForLead } from "@/services/activityService";
import { listAuditHistory } from "@/services/auditService";
import { listCompanies } from "@/services/companyService";
import { listCommunicationsForLead } from "@/services/communicationService";
import { getLead } from "@/services/leadService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { ActivityTimeline } from "../../_shared/ActivityTimeline";
import { AuditHistory } from "../../_shared/AuditHistory";
import { CommunicationTimeline } from "../../_shared/CommunicationTimeline";
import { TaskSection } from "../../_shared/TaskSection";
import { EditLeadForm } from "./EditLeadForm";
import { AssignLeadControl } from "../AssignLeadControl";
import { ConvertLeadControl } from "./ConvertLeadControl";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; leadId: string }>;
}) {
  const { orgSlug, leadId } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  let lead;
  try {
    lead = await getLead(ctx, leadId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">
          This lead exists but you do not have permission to view it.
        </p>
      );
    }
    throw err;
  }

  const referenceData = await getFormReferenceData(ctx);

  const canEdit =
    hasPermission(ctx, "leads.edit.all") ||
    (hasPermission(ctx, "leads.edit.own") &&
      lead.ownerMembershipId === ctx.membershipId);
  const canConvert =
    hasPermission(ctx, "leads.convert") && canEdit && !lead.convertedAt;
  const companies = canConvert && !lead.companyId
    ? await listCompanies(ctx)
    : [];

  let activities: Awaited<ReturnType<typeof listActivitiesForLead>> = [];
  try {
    activities = await listActivitiesForLead(ctx, leadId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  try {
    tasks = await listTasks(ctx, { leadId });
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let auditEvents: Awaited<ReturnType<typeof listAuditHistory>> = [];
  try {
    auditEvents = await listAuditHistory(ctx, "Lead", leadId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let communications: Awaited<ReturnType<typeof listCommunicationsForLead>> = [];
  try {
    communications = await listCommunicationsForLead(ctx, leadId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  return (
    <div>
      <p>
        <a href={`/o/${orgSlug}/leads`}>&larr; Leads</a>
      </p>
      <h1>
        {lead.company?.name ?? `${lead.contact?.firstName ?? "Untitled"} lead`}
      </h1>

      <div className="card">
        <p>
          Status: <span className="badge">{lead.leadStatus.name}</span> &nbsp;
          Temperature:{" "}
          <span
            className={`badge badge-${
              lead.temperature === "HOT"
                ? "red"
                : lead.temperature === "WARM"
                  ? "orange"
                  : "blue"
            }`}
          >
            {lead.temperature}
          </span>
        </p>
        <p>Source: {lead.leadSource?.name ?? "--"}</p>
        <p>
          Contact:{" "}
          {lead.contact
            ? `${lead.contact.firstName} ${lead.contact.lastName ?? ""}`
            : "--"}
        </p>
        <p>
          Next follow-up:{" "}
          {lead.nextFollowUpAt
            ? new Date(lead.nextFollowUpAt).toLocaleString()
            : "--"}
        </p>
        <p>Notes: {lead.notes ?? "--"}</p>
        {lead.convertedAt && (
          <p className="badge">
            Converted to a deal on{" "}
            {new Date(lead.convertedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {hasPermission(ctx, "leads.assign") && (
        <div className="card">
          <strong>Owner</strong>
          <AssignLeadControl
            orgSlug={orgSlug}
            leadId={lead.id}
            currentOwnerMembershipId={lead.ownerMembershipId}
            members={referenceData.members}
          />
        </div>
      )}

      {canConvert && (
        <div className="card">
          <strong>Convert to deal</strong>
          <ConvertLeadControl
            orgSlug={orgSlug}
            leadId={lead.id}
            hasCompany={Boolean(lead.companyId)}
            companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
      )}

      {canEdit && (
        <EditLeadForm
          orgSlug={orgSlug}
          lead={{
            id: lead.id,
            leadStatusId: lead.leadStatusId,
            leadSourceId: lead.leadSourceId,
            temperature: lead.temperature,
            notes: lead.notes,
            nextFollowUpAt: lead.nextFollowUpAt
              ? lead.nextFollowUpAt.toISOString().slice(0, 16)
              : "",
          }}
          leadStatuses={referenceData.leadStatuses}
          leadSources={referenceData.leadSources}
        />
      )}

      {hasPermission(ctx, "activities.view") && (
        <ActivityTimeline
          orgSlug={orgSlug}
          parentField="leadId"
          parentId={lead.id}
          activities={activities.map((a) => ({
            ...a,
            occurredAt: a.occurredAt.toISOString(),
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "activities.create")}
        />
      )}

      {(hasPermission(ctx, "tasks.view.own") ||
        hasPermission(ctx, "tasks.view.all")) && (
        <TaskSection
          orgSlug={orgSlug}
          parentField="leadId"
          parentId={lead.id}
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
          parentField="leadId"
          parentId={lead.id}
          communications={communications.map((c) => ({
            ...c,
            occurredAt: c.occurredAt.toISOString(),
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "communications.create")}
          defaultToEmail={lead.contact?.email ?? null}
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
