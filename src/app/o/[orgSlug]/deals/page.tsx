import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import {
  getDealOwnerNames,
  listAssignableDealOwners,
  listDeals,
} from "@/services/dealService";
import { recordPageView } from "@/services/pageViewService";
import { getFormReferenceData } from "@/services/referenceDataService";
import { NoAccess } from "../_shared/NoAccess";
import { IconCalendar, IconDownload, IconOpen, IconShield } from "../_shared/icons";
import { CreateDealForm } from "./CreateDealForm";
import { DealCardActions } from "./DealCardActions";
import { dealCapabilities } from "./dealCapabilities";

type DealRow = Awaited<ReturnType<typeof listDeals>>[number];

const OPEN_STAGE_TONES = ["blue", "orange", "green", "purple"] as const;

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Total value of a set of deals, e.g. "KES 1,750,000". Null when any value
 * is masked for this viewer -- a partial sum would understate the real
 * figure, so no total is shown at all rather than a misleading one.
 */
function totalLabel(deals: DealRow[]): string | null {
  if (deals.some((d) => d.valueMasked)) return null;
  const byCurrency = new Map<string, number>();
  for (const d of deals) {
    if (d.value === null || d.value === undefined) continue;
    byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + Number(d.value));
  }
  if (byCurrency.size === 0) return `${deals[0]?.currency ?? "KES"} 0`;
  return [...byCurrency.entries()]
    .map(([currency, n]) => `${currency} ${formatAmount(n)}`)
    .join(" \u00b7 ");
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function DealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ includeArchived?: string }>;
}) {
  const { orgSlug } = await params;
  const { includeArchived } = await searchParams;
  const showArchived = includeArchived === "true";
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "deals");

  // Restricted Technical has neither deals.view.all nor .own, so listDeals()
  // fails closed rather than returning an empty list -- show an explanation
  // and the nearest page that role can use instead of an error.
  let deals: DealRow[];
  try {
    deals = await listDeals(ctx, { includeArchived: showArchived });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Deals" />;
    }
    throw err;
  }

  const canCreate = hasPermission(ctx, "deals.create");
  const canPickOwner = hasPermission(ctx, "deals.edit.all");

  const [referenceData, companies, contacts, ownerNames, owners] = await Promise.all([
    getFormReferenceData(ctx),
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
    // Names for the owners of the deals this person can see -- the member
    // list itself stays Management-only, but every role that can see a deal
    // can see who owns it.
    getDealOwnerNames(
      ctx,
      deals.map((d) => d.ownerMembershipId),
    ),
    canPickOwner ? listAssignableDealOwners(ctx) : Promise.resolve([]),
  ]);

  const openStages = referenceData.pipelineStages.filter((s) => !s.isWon && !s.isLost);
  const closedStages = referenceData.pipelineStages.filter((s) => s.isWon || s.isLost);

  // KPIs describe live work, so archived deals (only listed when "Show
  // archived" is on) never count towards them.
  const live = deals.filter((d) => !d.archivedAt);
  const openDeals = live.filter((d) => d.outcome === "OPEN");
  const wonDeals = live.filter((d) => d.outcome === "WON");
  const lostDeals = live.filter((d) => d.outcome === "LOST");
  const openStagesInUse = new Set(openDeals.map((d) => d.pipelineStageId)).size;

  const valuesHidden = live.some((d) => d.valueMasked);

  const renderCard = (deal: DealRow) => {
    const caps = dealCapabilities(ctx, deal);
    const owner = ownerNames[deal.ownerMembershipId] ?? null;
    return (
      <div className={`deal-card${deal.archivedAt ? " is-archived" : ""}`} key={deal.id}>
        <DealCardActions
          orgSlug={orgSlug}
          dealId={deal.id}
          canArchive={caps.canArchive}
          canRestore={caps.canRestore}
        />
        <a className="deal-card-link" href={`/o/${orgSlug}/deals/${deal.id}`}>
          <div className="deal-card-title">
            <span>
              {deal.company.name}
              {deal.archivedAt && <span className="badge"> Archived</span>}
            </span>
            <IconOpen />
          </div>
          <div className="deal-card-value">
            {deal.valueMasked ? (
              <span className="deal-card-hidden">Value hidden</span>
            ) : deal.value === null || deal.value === undefined ? (
              <span className="deal-card-hidden">No value set</span>
            ) : (
              <>
                <span className="deal-card-currency">{deal.currency}</span>
                <span className="deal-card-amount">{formatAmount(Number(deal.value))}</span>
              </>
            )}
          </div>
          <div className="deal-card-meta">
            <span className="deal-card-meta-row">
              {owner ? (
                <span className="owner-chip">
                  <span className="owner-chip-avatar">{initialsFor(owner)}</span>
                  {owner}
                </span>
              ) : (
                <span className="owner-chip is-unassigned">No owner</span>
              )}
            </span>
            <span className="deal-card-meta-row">
              <IconCalendar />
              {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "No close date"}
            </span>
          </div>
        </a>
      </div>
    );
  };

  const renderColumn = (
    stage: (typeof referenceData.pipelineStages)[number],
    tone: string,
  ) => {
    const stageDeals = deals.filter((d) => d.pipelineStageId === stage.id);
    const total = totalLabel(stageDeals.filter((d) => !d.archivedAt));
    return (
      <div
        className={`board-column${stage.isWon ? " is-won" : ""}${stage.isLost ? " is-lost" : ""}`}
        key={stage.id}
      >
        <div className="board-column-head">
          <h3>
            <span className={`stage-dot tone-${tone}`} />
            {stage.name}
          </h3>
          <span className="board-column-total">{stageDeals.length}</span>
        </div>
        <div className="board-column-sum">{total ?? "Values hidden"}</div>
        {stageDeals.map(renderCard)}
        {stageDeals.length === 0 && <p className="deal-card-empty">No deals</p>}
      </div>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Deals</h1>
          <p className="who">
            {hasPermission(ctx, "deals.view.all")
              ? "Showing all organization deals."
              : hasPermission(ctx, "deals.view.won")
                ? "Showing won deals only."
                : "Showing only deals you own."}
            {!hasPermission(ctx, "deals.view.value") &&
              " Deal values are hidden unless you own the deal."}
          </p>
        </div>
        <div className="page-head-actions">
          <a
            className={`check-pill${showArchived ? " is-on" : ""}`}
            href={`/o/${orgSlug}/deals${showArchived ? "" : "?includeArchived=true"}`}
          >
            <span className="check-box" aria-hidden="true" />
            Show archived
          </a>
          {hasPermission(ctx, "deals.export") && (
            <a className="btn-ghost" href={`/api/orgs/${orgSlug}/deals/export`}>
              <IconDownload size={15} />
              Export CSV
            </a>
          )}
        </div>
      </div>

      {!hasPermission(ctx, "deals.edit.all") && !hasPermission(ctx, "deals.edit.own") && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You can view deals but not change them.</strong> Editing and
            archiving is handled by the people who own each deal and by
            Management.
          </p>
        </div>
      )}

      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-blue" />Open deals</div>
              <div className="kpi-value">{openDeals.length}</div>
              <div className="kpi-sub">
                across {openStagesInUse} stage{openStagesInUse === 1 ? "" : "s"}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-orange" />Open pipeline</div>
              <div className="kpi-value">{totalLabel(openDeals) ?? "Hidden"}</div>
              <div className="kpi-sub">
                {valuesHidden ? "values visible only on your own deals" : "value still in play"}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-green" />Won</div>
              <div className="kpi-value">{totalLabel(wonDeals) ?? "Hidden"}</div>
              <div className="kpi-sub">
                {wonDeals.length === 0
                  ? "no deals won yet"
                  : `${wonDeals.length} deal${wonDeals.length === 1 ? "" : "s"} closed won`}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-red" />Lost</div>
              <div className="kpi-value">{lostDeals.length}</div>
              <div className="kpi-sub">
                {lostDeals.length === 0 ? "no deals lost" : `deal${lostDeals.length === 1 ? "" : "s"} closed lost`}
              </div>
            </div>
          </div>

          <div className="section-label"><span>Open pipeline</span></div>
          <div className="board">
            {openStages.map((stage, i) =>
              renderColumn(stage, OPEN_STAGE_TONES[i % OPEN_STAGE_TONES.length]!),
            )}
          </div>

          <div className="section-label"><span>Closed</span></div>
          <div className="board">
            {closedStages.map((stage) => renderColumn(stage, stage.isWon ? "green" : "red"))}
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
                pipelineStages={openStages}
                owners={owners}
                defaultOwnerMembershipId={ctx.membershipId}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
