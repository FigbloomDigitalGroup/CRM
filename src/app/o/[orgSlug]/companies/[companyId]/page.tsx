import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { ForbiddenError, NotFoundError } from "@/auth/errors";
import { getCompany } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
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
    </div>
  );
}
