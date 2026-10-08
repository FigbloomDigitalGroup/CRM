import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { listCompanies } from "@/services/companyService";
import { ImportCsvForm } from "@/components/ImportCsvForm";
import { CreateCompanyForm } from "./CreateCompanyForm";

const IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "industry", label: "Industry" },
  { key: "website", label: "Website" },
  { key: "location", label: "Location" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "notes", label: "Notes" },
  { key: "lifecycleState", label: "Lifecycle state (by name)" },
  { key: "ownerEmail", label: "Owner (by email)" },
];

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string; includeArchived?: string }>;
}) {
  const { orgSlug } = await params;
  const { q, includeArchived } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);

  let companies;
  try {
    companies = await listCompanies(ctx, {
      query: q,
      includeArchived: includeArchived === "true",
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return (
        <p className="error">Your role does not have access to Companies.</p>
      );
    }
    throw err;
  }

  const canCreate = hasPermission(ctx, "companies.create");
  const canImport = hasPermission(ctx, "companies.import");

  return (
    <div>
      <h1>Companies</h1>

      <div className="list-with-side">
        <div className="list-with-side-main">
          {hasPermission(ctx, "companies.export") && (
            <p>
              <a href={`/api/orgs/${orgSlug}/companies/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}>
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
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                name="includeArchived"
                value="true"
                defaultChecked={includeArchived === "true"}
              />
              Show archived
            </label>
            <button type="submit" className="secondary">
              Search
            </button>
          </form>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
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
                      {c.archivedAt && <span className="badge"> Archived</span>}
                    </td>
                    <td>{c.industry ?? "--"}</td>
                    <td>{c.email ?? "--"}</td>
                    <td>{c.phone ?? "--"}</td>
                    <td>
                      {c.lifecycleStateId ? (
                        <span className="badge badge-green">set</span>
                      ) : (
                        "--"
                      )}
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
          </div>
        </div>

        {(canCreate || canImport) && (
          <div className="list-with-side-rail">
            {canCreate && (
              <>
                <h2>New company</h2>
                <div className="card">
                  <CreateCompanyForm orgSlug={orgSlug} />
                </div>
              </>
            )}

            {canImport && (
              <>
                <h2>Import companies from CSV</h2>
                <div className="card">
                  <ImportCsvForm
                    importUrl={`/api/orgs/${orgSlug}/companies/import`}
                    fields={IMPORT_FIELDS}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
