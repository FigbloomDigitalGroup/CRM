import { notFound } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listActivitiesForContact } from "@/services/activityService";
import { listAuditHistory } from "@/services/auditService";
import { getContact, listAssignableContactOwners, listContacts } from "@/services/contactService";
import { listCompanies } from "@/services/companyService";
import { listCommunicationsForContact } from "@/services/communicationService";
import { recordPageView } from "@/services/pageViewService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { ActivityTimeline } from "../../_shared/ActivityTimeline";
import { ArchiveControl } from "../../_shared/ArchiveControl";
import { AuditHistory } from "../../_shared/AuditHistory";
import { CommunicationTimeline } from "../../_shared/CommunicationTimeline";
import { MergeControl } from "../../_shared/MergeControl";
import { NoAccess } from "../../_shared/NoAccess";
import { OwnerChip } from "../../_shared/OwnerChip";
import { accountCapabilities } from "../../_shared/accountCapabilities";
import { IconShield } from "../../_shared/icons";
import { TaskSection } from "../../_shared/TaskSection";
import { EditContactForm } from "./EditContactForm";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; contactId: string }>;
}) {
  const { orgSlug, contactId } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "contacts_detail");

  let contact;
  try {
    contact = await getContact(ctx, contactId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Contacts" />;
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

  const caps = accountCapabilities(ctx, "contacts", contact);
  const [owners, companyList] = await Promise.all([
    caps.canReassign ? listAssignableContactOwners(ctx) : Promise.resolve([]),
    caps.canEdit && hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
  ]);
  const ownerName = contact.owner?.user.name ?? null;
  const fullName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  const canMerge = caps.canMerge;
  const mergeOptions = canMerge
    ? (await listContacts(ctx))
        .filter((c) => c.id !== contact.id && !c.archivedAt)
        .map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName ?? ""}`.trim() }))
    : [];

  return (
    <div>
      <div className="detail-head">
        <div>
          <a className="detail-back" href={`/o/${orgSlug}/contacts`}>
            &larr; Contacts
          </a>
          <div className="detail-title">
            <h1>{fullName}</h1>
            {contact.archivedAt && <span className="badge">Archived</span>}
          </div>
          <div className="detail-meta">
            <span>Owner</span>
            <OwnerChip name={ownerName} />
            <span>Added {contact.createdAt.toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {contact.archivedAt && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>This contact is archived.</strong> It is read-only until it
            is restored &mdash; no edits or merging.
          </p>
        </div>
      )}
      {!contact.archivedAt && !hasPermission(ctx, "contacts.edit") && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You can view this contact but not change it.</strong>{" "}
            Editing is handled by the Sales and Management teams.
          </p>
        </div>
      )}

      <div className="card">
        <strong>Details</strong>
        <dl className="detail-grid">
          <div>
            <dt>Company</dt>
            <dd>
              {contact.company ? (
                hasPermission(ctx, "companies.view") ? (
                  <a href={`/o/${orgSlug}/companies/${contact.company.id}`}>
                    {contact.company.name}
                  </a>
                ) : (
                  contact.company.name
                )
              ) : (
                "(standalone contact)"
              )}
            </dd>
          </div>
          <div>
            <dt>Job title</dt>
            <dd>{contact.jobTitle ?? "--"}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{contact.department ?? "--"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{contact.email ?? "--"}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{contact.phone ?? "--"}</dd>
          </div>
          <div className="is-wide">
            <dt>Notes</dt>
            <dd>{contact.notes ?? "--"}</dd>
          </div>
        </dl>
      </div>

      {caps.canEdit && (
        <div className="card">
          <strong>Edit contact</strong>
          <EditContactForm
            orgSlug={orgSlug}
            contact={{
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              jobTitle: contact.jobTitle,
              department: contact.department,
              email: contact.email,
              phone: contact.phone,
              notes: contact.notes,
              companyId: contact.companyId,
              companyName: contact.company?.name ?? null,
              ownerMembershipId: contact.ownerMembershipId,
            }}
            companies={companyList.map((c) => ({ id: c.id, name: c.name }))}
            owners={owners}
            ownerName={ownerName}
            canAssign={caps.canReassign}
          />
        </div>
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
        canArchive={caps.canArchive || caps.canRestore}
      />
    </div>
  );
}
