import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { ImportCsvForm } from "@/components/ImportCsvForm";
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

      {hasPermission(ctx, "contacts.export") && (
        <p>
          <a href={`/api/orgs/${orgSlug}/contacts/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}>
            Export CSV
          </a>
        </p>
      )}

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

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
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
      </div>

      {hasPermission(ctx, "contacts.create") && (
        <>
          <h2>New contact</h2>
          <div className="card">
            <CreateContactForm
              orgSlug={orgSlug}
              companies={companies.map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        </>
      )}

      {hasPermission(ctx, "contacts.import") && (
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
  );
}
