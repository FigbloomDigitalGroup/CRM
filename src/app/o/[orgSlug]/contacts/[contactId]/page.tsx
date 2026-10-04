import { notFound } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listActivitiesForContact } from "@/services/activityService";
import { listAuditHistory } from "@/services/auditService";
import { getContact, listContacts } from "@/services/contactService";
import { listCommunicationsForContact } from "@/services/communicationService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { ActivityTimeline } from "../../_shared/ActivityTimeline";
import { ArchiveControl } from "../../_shared/ArchiveControl";
import { AuditHistory } from "../../_shared/AuditHistory";
import { CommunicationTimeline } from "../../_shared/CommunicationTimeline";
import { MergeControl } from "../../_shared/MergeControl";
import { TaskSection } from "../../_shared/TaskSection";
import { EditContactForm } from "./EditContactForm";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; contactId: string }>;
}) {
  const { orgSlug, contactId } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  let contact;
  try {
    contact = await getContact(ctx, contactId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">Your role does not have access to Contacts.</p>
      );
    }
    throw err;
  }

  const referenceData = await getFormReferenceData(ctx);

  let communications: Awaited<ReturnType<typeof listCommunicationsForContact>> = [];
  try {
    communications = await listCommunicationsForContact(ctx, contactId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let activities: Awaited<ReturnType<typeof listActivitiesForContact>> = [];
  try {
    activities = await listActivitiesForContact(ctx, contactId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  try {
    tasks = await listTasks(ctx, { contactId });
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  let auditEvents: Awaited<ReturnType<typeof listAuditHistory>> = [];
  try {
    auditEvents = await listAuditHistory(ctx, "Contact", contactId);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const canMerge = hasPermission(ctx, "contacts.merge") && !contact.archivedAt;
  const mergeOptions = canMerge
    ? (await listContacts(ctx))
        .filter((c) => c.id !== contact.id && !c.archivedAt)
        .map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName ?? ""}`.trim() }))
    : [];

  return (
    <div>
      <p>
        <a href={`/o/${orgSlug}/contacts`}>&larr; Contacts</a>
      </p>
      <h1>
        {contact.firstName} {contact.lastName ?? ""}
        {contact.archivedAt && <span className="badge"> Archived</span>}
      </h1>

      <div className="card">
        <p>Company: {contact.company?.name ?? "(standalone contact)"}</p>
        <p>Job title: {contact.jobTitle ?? "--"}</p>
        <p>Department: {contact.department ?? "--"}</p>
        <p>Email: {contact.email ?? "--"}</p>
        <p>Phone: {contact.phone ?? "--"}</p>
        <p>Notes: {contact.notes ?? "--"}</p>
      </div>

      {hasPermission(ctx, "contacts.edit") && (
        <EditContactForm orgSlug={orgSlug} contact={contact} />
      )}

      {hasPermission(ctx, "activities.view") && (
        <ActivityTimeline
          orgSlug={orgSlug}
          parentField="contactId"
          parentId={contact.id}
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
          parentField="contactId"
          parentId={contact.id}
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
          parentField="contactId"
          parentId={contact.id}
          communications={communications.map((c) => ({
            ...c,
            occurredAt: c.occurredAt.toISOString(),
          }))}
          members={referenceData.members}
          canCreate={hasPermission(ctx, "communications.create")}
          defaultToEmail={contact.email}
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
        basePath={`contacts/${contact.id}`}
        bodyKey="intoContactId"
        options={mergeOptions}
        canMerge={canMerge}
      />

      <ArchiveControl
        orgSlug={orgSlug}
        basePath={`contacts/${contact.id}`}
        archivedAt={contact.archivedAt?.toISOString() ?? null}
        canArchive={hasPermission(ctx, "contacts.archive")}
      />
    </div>
  );
}
