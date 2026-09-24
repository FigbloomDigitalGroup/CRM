import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { CreateContactForm } from "./CreateContactForm";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { orgSlug } = await params;
  const { q } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);

  let contacts;
  try {
    contacts = await listContacts(ctx, { query: q });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">Your role does not have access to Contacts.</p>
      );
    }
    throw err;
  }

  const companies = hasPermission(ctx, "companies.view")
    ? await listCompanies(ctx)
    : [];

  return (
    <div>
      <h1>Contacts</h1>

      <form className="filters" method="GET">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name, email, phone"
        />
        <button type="submit" className="secondary">
          Search
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Company</th>
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
              <td>{c.company?.name ?? "--"}</td>
              <td>{c.jobTitle ?? "--"}</td>
              <td>{c.email ?? "--"}</td>
              <td>{c.phone ?? "--"}</td>
            </tr>
          ))}
          {contacts.length === 0 && (
            <tr>
              <td colSpan={5}>No contacts yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {hasPermission(ctx, "contacts.create") && (
        <>
          <h2>New contact</h2>
          <CreateContactForm
            orgSlug={orgSlug}
            companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          />
        </>
      )}
    </div>
  );
}
