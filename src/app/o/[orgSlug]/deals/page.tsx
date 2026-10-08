import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { listDeals } from "@/services/dealService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { CreateDealForm } from "./CreateDealForm";

export default async function DealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ includeArchived?: string }>;
}) {
  const { orgSlug } = await params;
  const { includeArchived } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);

  // Delivery/Finance/Restricted Technical have deals.view.all/none per the
  // FIG-438 seed; Restricted Technical has neither, so listDeals() fails
  // closed rather than returning an empty list -- same as the Leads page.
  let deals;
  try {
    deals = await listDeals(ctx, { includeArchived: includeArchived === "true" });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <p className="error">Your role does not have access to Deals.</p>;
    }
    throw err;
  }

  const [referenceData, companies, contacts] = await Promise.all([
    getFormReferenceData(ctx),
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
  ]);

  const ownerName = (membershipId: string) =>
    referenceData.members.find((m) => m.membershipId === membershipId)
      ?.userName ?? "--";

  const currencyFormat = (
    value: unknown,
    currency: string,
    masked: boolean,
  ) =>
    masked
      ? "hidden"
      : value === null || value === undefined
        ? "not set"
        : `${currency} ${Number(value).toLocaleString()}`;

  const canCreate = hasPermission(ctx, "deals.create");

  return (
    <div>
      <h1>Deals</h1>

      <div className="list-with-side">
        <div className="list-with-side-main">
          {hasPermission(ctx, "deals.export") && (
            <p>
              <a href={`/api/orgs/${orgSlug}/deals/export`}>Export CSV</a>
            </p>
          )}

          <p>
            <a href={`/o/${orgSlug}/deals${includeArchived === "true" ? "" : "?includeArchived=true"}`}>
              {includeArchived === "true" ? "Hide archived deals" : "Show archived deals"}
            </a>
          </p>

          <p className="who">
            {hasPermission(ctx, "deals.view.all")
              ? "Showing all organization deals (deals.view.all)."
              : "Showing only deals you own (deals.view.own) -- enforced server-side."}
            {!hasPermission(ctx, "deals.view.value") &&
              " Deal values are hidden unless you own the deal (deals.view.value not granted)."}
          </p>

          <div className="board">
            {referenceData.pipelineStages.map((stage) => (
              <div className="board-column" key={stage.id}>
                <h3>{stage.name}</h3>
                {deals
                  .filter((d) => d.pipelineStageId === stage.id)
                  .map((deal) => (
                    <a
                      key={deal.id}
                      className="deal-card"
                      href={`/o/${orgSlug}/deals/${deal.id}`}
                    >
                      <div>
                        {deal.company.name}
                        {deal.archivedAt && <span className="badge"> Archived</span>}
                      </div>
                      <div className="value">
                        {currencyFormat(deal.value, deal.currency, deal.valueMasked)}
                      </div>
                      <div>{ownerName(deal.ownerMembershipId)}</div>
                      <div>
                        {deal.expectedCloseDate
                          ? new Date(deal.expectedCloseDate).toLocaleDateString()
                          : "no close date"}
                      </div>
                    </a>
                  ))}
                {deals.filter((d) => d.pipelineStageId === stage.id).length ===
                  0 && <p className="who">No deals.</p>}
              </div>
            ))}
          </div>
        </div>

        {canCreate && (
          <div className="list-with-side-rail">
            <h2>New deal</h2>
            <div className="card">
              <CreateDealForm
                orgSlug={orgSlug}
                companies={companies.map((c) => ({ id: c.id, name: c.name }))}
                contacts={contacts.map((c) => ({
                  id: c.id,
                  name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
                }))}
                services={referenceData.services}
                pipelineStages={referenceData.pipelineStages.filter(
                  (s) => !s.isWon && !s.isLost,
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
