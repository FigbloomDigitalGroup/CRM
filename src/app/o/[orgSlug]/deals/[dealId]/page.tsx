import { notFound } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listActivitiesForDeal } from "@/services/activityService";
import { listAuditHistory } from "@/services/auditService";
import { listCommunicationsForDeal } from "@/services/communicationService";
import { listContacts } from "@/services/contactService";
import { getDeal } from "@/services/dealService";
import { listProposalReferences } from "@/services/proposalService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { ActivityTimeline } from "../../_shared/ActivityTimeline";
import { ArchiveControl } from "../../_shared/ArchiveControl";
import { AuditHistory } from "../../_shared/AuditHistory";
import { CommunicationTimeline } from "../../_shared/CommunicationTimeline";
import { TaskSection } from "../../_shared/TaskSection";
import { EditDealForm } from "./EditDealForm";
import { ProposalReferences } from "./ProposalReferences";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; dealId: string }>;
}) {
  const { orgSlug, dealId } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  let deal;
  try {
    deal = await getDeal(ctx, dealId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">
          This deal exists but you do not have permission to view it.
        </p>
      );
    }
    throw err;
  }

  // proposals.view is Sales/Management-only (Delivery/Finance/Restricted
  // Technical have neither) -- listProposalReferences fails closed for
  // them, so this section is simply omitted rather than crashing the page.
  let proposals: Awaited<ReturnType<typeof listProposalReferences>> = [];
  try {
    proposals = await listProposalReferences(ctx, dealId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const [referenceData, contacts] = await Promise.all([
    getFormReferenceData(ctx),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
  ]);

  // activities.view/tasks.view.*/audit.view can each independently be
  // absent (e.g. Finance has none of the three) -- each section fails
  // closed and is simply omitted rather than crashing the page.
  let activities: Awaited<ReturnType<typeof listActivitiesForDeal>> = [];
  try {
    activities = await listActivitiesForDeal(ctx, dealId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  try {
    tasks = await listTasks(ctx, { dealId });
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let auditEvents: Awaited<ReturnType<typeof listAuditHistory>> = [];
  try {
    auditEvents = await listAuditHistory(ctx, "Deal", dealId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let communications: Awaited<ReturnType<typeof listCommunicationsForDeal>> = [];
  try {
    communications = await listCommunicationsForDeal(ctx, dealId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const canEdit =
    hasPermission(ctx, "deals.edit.all") ||
    (hasPermission(ctx, "deals.edit.own") &&
      deal.ownerMembershipId === ctx.membershipId);
  const canManageProposals = hasPermission(ctx, "proposals.manage") && canEdit;

  const valueDisplay = deal.valueMasked
    ? "hidden"
    : deal.value === null
      ? "not set"
      : `${deal.currency} ${Number(deal.value).toLocaleString()}`;

  return (
    <div>
      <p>
        <a href={`/o/${orgSlug}/deals`}>&larr; Deals</a>
      </p>
      <h1>
        {deal.company.name}
        {deal.archivedAt && <span className="badge"> Archived</span>}
      </h1>

      <div className="card">
        <p>
          Stage: <span className="badge">{deal.pipelineStage.name}</span>
          &nbsp; Outcome:{" "}
          <span
            className={`badge${
              deal.outcome === "WON"
                ? " badge-green"
                : deal.outcome === "LOST"
                  ? " badge-red"
                  : ""
            }`}
          >
            {deal.outcome}
          </span>
        </p>
        <p>Service: {deal.service?.name ?? "--"}</p>
        <p>
          Primary contact:{" "}
          {deal.primaryContact
            ? `${deal.primaryContact.firstName} ${deal.primaryContact.lastName ?? ""}`
            : "--"}
        </p>
        <p>Value: {valueDisplay}</p>
        <p>
          Expected close:{" "}
          {deal.expectedCloseDate
            ? new Date(deal.expectedCloseDate).toLocaleDateString()
            : "--"}
        </p>
        {deal.outcome === "LOST" && (
          <p>Lost reason: {deal.lostReason?.name ?? "--"}</p>
        )}
        <p>
          Owner:{" "}
          {referenceData.members.find(
            (m) => m.membershipId === deal.ownerMembershipId,
          )?.userName ?? "--"}
        </p>
        {deal.lead && <p className="badge">Converted from a lead</p>}
        <p>Notes: {deal.notes ?? "--"}</p>
      </div>

      {canEdit && (
        <EditDealForm
          orgSlug={orgSlug}
          deal={{
            id: deal.id,
            primaryContactId: deal.primaryContactId,
            serviceId: deal.serviceId,
            pipelineStageId: deal.pipelineStageId,
            value: deal.valueMasked || deal.value === null ? "" : String(deal.value),
            currency: deal.currency,
            expectedCloseDate: deal.expectedCloseDate
              ? deal.expectedCloseDate.toISOString().slice(0, 10)
              : "",
            notes: deal.notes,
          }}
          contacts={contacts.map((c) => ({
            id: c.id,
            name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
          }))}
          services={referenceData.services}
          pipelineStages={referenceData.pipelineStages}
          lostReasons={referenceData.lostReasons}
        />
      )}

      {hasPermission(ctx, "proposals.view") && canEdit && (
        <ProposalReferences
          orgSlug={orgSlug}
          dealId={deal.id}
          proposals={proposals.map((p) => ({
            id: p.id,
            proposalNumber: p.proposalNumber,
            status: p.status,
            amount: p.amount === null ? null : String(p.amount),
            currency: p.currency,
          }))}
          canManage={canManageProposals}
        />
      )}

      {hasPermission(ctx, "activities.view") && (
        <ActivityTimeline
          orgSlug={orgSlug}
          parentField="dealId"
          parentId={deal.id}
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
          parentField="dealId"
          parentId={deal.id}
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
          parentField="dealId"
          parentId={deal.id}
          communications={communications.map((c) => ({
            ...c,
            occurredAt: c.occurredAt.toISOString(),
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "communications.create")}
          defaultToEmail={deal.primaryContact?.email ?? null}
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

      <ArchiveControl
        orgSlug={orgSlug}
        basePath={`deals/${deal.id}`}
        archivedAt={deal.archivedAt?.toISOString() ?? null}
        canArchive={
          hasPermission(ctx, "deals.archive.all") ||
          (hasPermission(ctx, "deals.archive.own") &&
            deal.ownerMembershipId === ctx.membershipId)
        }
      />
    </div>
  );
}
