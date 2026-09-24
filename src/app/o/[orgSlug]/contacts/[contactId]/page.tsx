import { notFound } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { getContact } from "@/services/contactService";
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

  return (
    <div>
      <p>
        <a href={`/o/${orgSlug}/contacts`}>&larr; Contacts</a>
      </p>
      <h1>
        {contact.firstName} {contact.lastName ?? ""}
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
    </div>
  );
}
