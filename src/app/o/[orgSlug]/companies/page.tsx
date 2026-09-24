import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { listCompanies } from "@/services/companyService";
import { CreateCompanyForm } from "./CreateCompanyForm";

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { orgSlug } = await params;
  const { q } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);

  let companies;
  try {
    companies = await listCompanies(ctx, { query: q });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">Your role does not have access to Companies.</p>
      );
    }
    throw err;
  }

  return (
    <div>
      <h1>Companies</h1>

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
            <th>Industry</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Lifecycle</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>
                <a href={`/o/${orgSlug}/companies/${c.id}`}>{c.name}</a>
              </td>
              <td>{c.industry ?? "--"}</td>
              <td>{c.email ?? "--"}</td>
              <td>{c.phone ?? "--"}</td>
              <td>
                {c.lifecycleStateId ? <span className="badge">set</span> : "--"}
              </td>
            </tr>
          ))}
          {companies.length === 0 && (
            <tr>
              <td colSpan={5}>No companies yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {hasPermission(ctx, "companies.create") && (
        <>
          <h2>New company</h2>
          <CreateCompanyForm orgSlug={orgSlug} />
        </>
      )}
    </div>
  );
}
