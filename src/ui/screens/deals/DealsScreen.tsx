"use client";

import { AlertTriangle, ArrowLeftRight, Archive, Ban, Briefcase, Calendar, Clock, Download, Info, Kanban, List, Package, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useState, type DragEvent, type ReactNode } from "react";
import { useMember } from "../../data/member";
import { ErrorState } from "../../components/states";
import { useToast } from "../../components/toast";
import { useAllDeals, useHandoffStatuses, useMemberName, useRefData } from "./data";
import { NewDealDrawer } from "./NewDealDrawer";
import { dateLong, dealTitle, dealValue, flagsFor, initials, isMasked, kes, ago, num, stageTone, type DealItem, type Flag, type Stage } from "./model";
import { useDealMover, type MoveTarget } from "./useDealMover";

/**
 * F2.04 / P1: the deals board and list. Columns, counts and totals come from the same read the list uses; values the API masks are never
 * shown or summed. A card can be dragged to another stage, or moved with the Move to… button, which is the keyboard and touch way and is
 * always on the card. Won-only roles (Delivery, Finance) see one read-only column.
 */

const TONE: Record<Flag["tone"], string> = { orange: "fb-dflag--orange", red: "fb-dflag--red", blue: "fb-dflag--blue", neutral: "fb-dflag--neutral" };
const FLAG_ICON = { clock: Clock, alert: AlertTriangle, send: Send, archive: Archive, package: Package, ban: Ban } as const;

export function DealsScreen() {
  const member = useMember();
  const { can, orgSlug } = member;
  const toast = useToast();
  const ref = useRefData();
  const nameOf = useMemberName();
  const [view, setView] = useState<"board" | "list">("board");
  const [archived, setArchived] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const deals = useAllDeals(archived);

  const readOnly = !can("deals.view.all") && !can("deals.view.own") && can("deals.view.won");
  const mgmt = can("deals.view.all") && can("deals.edit.all");
  const canSeeValues = can("deals.view.value") || can("deals.view.own");
  const handoffs = useHandoffStatuses(true);
  const mover = useDealMover(ref.data);

  const items = deals.data?.items ?? [];
  const lostName = (d: DealItem) => (d.lostReasonId ? ref.data?.lostReasons.find((r) => r.id === d.lostReasonId)?.name : undefined);

  const canMove = (d: DealItem) => !d.archivedAt && (can("deals.edit.all") || (can("deals.edit.own") && d.ownerMembershipId === member.membershipId));
  const target = (d: DealItem): MoveTarget => ({ id: d.id, company: d.company.name, stageId: d.pipelineStageId, outcome: d.outcome as MoveTarget["outcome"], title: dealTitle(d), valueLabel: valueLabel(d) });

  const open = items.filter((d) => d.outcome === "OPEN");
  const won = items.filter((d) => d.outcome === "WON");
  const lost = items.filter((d) => d.outcome === "LOST");
  const sum = (list: DealItem[]) => list.reduce((a, d) => a + (dealValue(d) ?? 0), 0);
  const anyHidden = (list: DealItem[]) => list.some(isMasked);
  const allHidden = (list: DealItem[]) => list.length > 0 && list.every(isMasked);

  const stats = readOnly
    ? [
        { l: "Won deals", v: String(won.length), sub: "handed to delivery", dot: "var(--primary)" },
        { l: "Won value", v: allHidden(won) || anyHidden(won) ? "Values hidden" : kes(sum(won)), sub: allHidden(won) || anyHidden(won) ? "not shown for your role" : "contracted", dot: "var(--orange)", muted: allHidden(won) || anyHidden(won) },
        { l: "In onboarding", v: handoffs.data && handoffs.data.size > 0 ? String([...handoffs.data.values()].filter((s) => s !== "DELIVERED").length) : "—", sub: "not yet delivered", dot: "var(--blue)" },
      ]
    : [
        { l: "Open deals", v: String(open.length), sub: `across ${new Set(open.map((d) => d.pipelineStageId)).size} stages`, dot: "var(--blue)" },
        { l: "Open pipeline", v: allHidden(open) ? "Values hidden" : kes(sum(open)), sub: "value still in play", dot: "var(--orange)", muted: allHidden(open) },
        { l: "Won", v: allHidden(won) ? "Values hidden" : kes(sum(won)), sub: `${won.length} deal${won.length === 1 ? "" : "s"} closed won`, dot: "var(--primary)", muted: allHidden(won) },
        { l: "Lost", v: String(lost.length), sub: lost.length ? "see lost reasons in Reports" : "no deals lost", dot: "var(--red)" },
      ];

  function valueLabel(d: DealItem): string {
    const v = dealValue(d);
    return isMasked(d) ? "Values hidden" : v === null ? "No value yet" : kes(v, d.currency);
  }

  const stages = ref.data?.stages ?? [];
  const groups: { label: string; tip?: string; cols: { stage: Stage; list: DealItem[]; emptyText: string }[] }[] = readOnly
    ? [
        {
          label: "WON DEALS",
          tip: canSeeValues ? undefined : `Prices are hidden for ${member.roleName}`,
          cols: stages.filter((s) => s.isWon).map((s) => ({ stage: s, list: won, emptyText: "No won deals yet" })),
        },
      ]
    : [
        { label: "OPEN PIPELINE", tip: "Drag cards between stages, or use ⇄ on a card", cols: stages.filter((s) => !s.isWon && !s.isLost).map((s) => ({ stage: s, list: open.filter((d) => d.pipelineStageId === s.id), emptyText: "Drop a deal here" })) },
        {
          label: "CLOSED",
          cols: [
            ...stages.filter((s) => s.isWon).map((s) => ({ stage: s, list: won, emptyText: "No deals won yet" })),
            ...stages.filter((s) => s.isLost).map((s) => ({ stage: s, list: lost, emptyText: "No deals lost" })),
          ],
        },
      ];

  const loading = deals.isLoading || ref.isLoading;
  const failed = deals.error ?? ref.error;
  const empty = !loading && !failed && items.length === 0;

  function onDrop(e: DragEvent, stage: Stage) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setOver(null);
    setDragId(null);
    const d = items.find((x) => x.id === id);
    if (d && canMove(d)) void mover.requestMove(target(d), stage.id);
  }

  const scope = mgmt ? { tone: "org", label: `All organisation deals · ${items.length}` } : readOnly ? { tone: "ro", label: "Read-only · won deals" } : { tone: "own", label: `My deals · ${items.length}` };

  return (
    <div className="fb-deals" data-screen-label="Deals board">
      <div className="fb-deals__head">
        <div>
          <h1 className="fb-deals__h1">{readOnly ? "Won deals" : "Deals"}</h1>
          <div className="fb-deals__sub">
            <span className="fb-dscope" data-tone={scope.tone}>
              <span className="fb-dscope__dot" aria-hidden="true" />
              {scope.label}
            </span>
            <span className="fb-deals__hint">
              {mgmt ? "Showing all organisation deals." : readOnly ? "Won deals and their handoff status. You can’t edit the pipeline." : "Showing deals you own. You see values on your own deals."}
            </span>
          </div>
        </div>
        <div className="fb-deals__tools">
          <div className="fb-dseg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
              <Kanban size={15} aria-hidden="true" />
              Board
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <List size={15} aria-hidden="true" />
              List
            </button>
          </div>
          <label className="fb-dtool fb-dtool--check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Show archived
          </label>
          {can("deals.export") ? (
            <a className="fb-dtool" href={`/api/orgs/${orgSlug}/deals/export`} download onClick={() => toast.show({ message: "Exporting deals… your CSV is downloading." })}>
              <Download size={16} aria-hidden="true" />
              Export CSV
            </a>
          ) : null}
          {can("deals.create") ? (
            <button type="button" className="fb-dtool fb-dtool--primary" onClick={() => setDrawer(true)}>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              New deal
            </button>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <div className="fb-dprov" role="note">
          <Info size={17} aria-hidden="true" />
          <span>
            <strong>Provisional access.</strong> The seeded matrix gives {member.roleName} “view all deals”, including the open pipeline. Following the stakeholder brief, this view shows won deals only. Needs Michael’s sign-off (FIG-444).
          </span>
        </div>
      ) : null}

      {!failed ? (
        <div className="fb-dstats">
          {stats.map((s) => (
            <div key={s.l} className="fb-dstat">
              <div className="fb-dstat__l">
                <span className="fb-dstat__dot" style={{ background: s.dot }} aria-hidden="true" />
                {s.l}
              </div>
              <div className="fb-dstat__v" data-muted={s.muted || undefined}>
                {loading ? "…" : s.v}
              </div>
              <div className="fb-dstat__sub">{s.sub}</div>
            </div>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="fb-dboard__skel" role="status" aria-busy="true">
          <span className="fb-sr-only">Loading the board</span>
          {[1, 2, 3].map((i) => (
            <div key={i} className="fb-dskel" />
          ))}
        </div>
      ) : null}
      {failed ? (
        <div className="fb-dstate">
          <ErrorState error={failed} area="Deals" onRetry={() => { void deals.refetch(); }} />
        </div>
      ) : null}
      {empty ? (
        <div className="fb-dstate fb-dstate--empty">
          <span className="fb-dstate__icon"><Briefcase size={26} aria-hidden="true" /></span>
          <div className="fb-dstate__title">No deals yet</div>
          <div className="fb-dstate__body">Deals start when you convert a qualified lead.</div>
          {can("deals.create") ? (
            <Link href={`/o/${orgSlug}/leads`} className="fb-dtool fb-dtool--primary fb-dstate__cta">
              Go to leads
            </Link>
          ) : null}
        </div>
      ) : null}

      {!loading && !failed && !empty && view === "board"
        ? groups.map((g) => (
            <section key={g.label} aria-label={g.label.toLowerCase()} className="fb-dgroup">
              <div className="fb-dgroup__label">
                {g.label}
                <span className="fb-dgroup__rule" aria-hidden="true" />
                {g.tip ? <span className="fb-dgroup__tip">{g.tip}</span> : null}
              </div>
              <div className="fb-dcols">
                {g.cols.map(({ stage, list, emptyText }) => (
                  <BoardColumn
                    key={stage.id}
                    stage={stage}
                    list={list}
                    emptyText={emptyText}
                    over={over === stage.id}
                    dragging={dragId !== null}
                    canSeeValues={canSeeValues}
                    onOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      if (over !== stage.id) setOver(stage.id);
                    }}
                    onLeave={() => over === stage.id && setOver(null)}
                    onDrop={(e) => onDrop(e, stage)}
                  >
                    {list.map((d) => (
                      <DealCard
                        key={d.id}
                        d={d}
                        orgSlug={orgSlug}
                        zone={member.timeZone}
                        movable={canMove(d)}
                        dragging={dragId === d.id}
                        flags={flagsFor(d, handoffs.data?.get(d.id), lostName(d))}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", d.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(d.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOver(null);
                        }}
                        onMove={() => mover.openMoveTo(target(d))}
                      />
                    ))}
                  </BoardColumn>
                ))}
              </div>
            </section>
          ))
        : null}

      {!loading && !failed && !empty && view === "list" ? (
        <section className="fb-dtablewrap" aria-label="Deals list">
          <div className="fb-dtablescroll">
            <table className="fb-dtable">
              <caption className="fb-sr-only">Deals</caption>
              <thead>
                <tr>
                  {["COMPANY / DEAL", "STAGE", "VALUE", "OWNER", "EXPECTED CLOSE", "LAST ACTIVITY", "FLAGS"].map((c, i) => (
                    <th key={c} scope="col" style={{ textAlign: i === 2 ? "right" : "left" }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((d) => {
                  const stage = stages.find((s) => s.id === d.pipelineStageId) ?? d.pipelineStage;
                  const v = dealValue(d);
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/o/${orgSlug}/deals/${d.id}`} className="fb-dlink">
                          {d.company.name}
                        </Link>
                        <div className="fb-dtable__title">{dealTitle(d)}</div>
                      </td>
                      <td>
                        <span className="fb-dstage">
                          <span className="fb-dstage__dot" style={{ background: stageTone(stage as Stage) }} aria-hidden="true" />
                          {stage.name}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: v === null ? "var(--text-3)" : "var(--text)" }}>{v === null ? (isMasked(d) ? "Values hidden" : "No value yet") : kes(v, d.currency)}</td>
                      <td>{nameOf(d.ownerMembershipId)}</td>
                      <td className="fb-dmuted">{dateLong(d.expectedCloseDate as string | null, member.timeZone)}</td>
                      <td className="fb-dmuted">{ago(d.lastActivityAt)}</td>
                      <td>
                        <div className="fb-dflags">
                          {flagsFor(d, handoffs.data?.get(d.id), lostName(d)).map((f) => (
                            <span key={f.key} className={`fb-dflag ${TONE[f.tone]}`}>
                              {f.label}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {deals.data?.truncated ? (
        <p className="fb-dprov fb-dprov--quiet" role="note">
          <Info size={16} aria-hidden="true" /> Showing the first {num(items.length)} of {num(deals.data.total)} deals. Open a deal from search to reach the rest.
        </p>
      ) : null}

      {mover.host}
      {drawer ? <NewDealDrawer ref_={ref.data} onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}

function BoardColumn({
  stage,
  list,
  emptyText,
  over,
  dragging,
  canSeeValues,
  onOver,
  onLeave,
  onDrop,
  children,
}: {
  stage: Stage;
  list: DealItem[];
  emptyText: string;
  over: boolean;
  dragging: boolean;
  canSeeValues: boolean;
  onOver: (e: DragEvent) => void;
  onLeave: () => void;
  onDrop: (e: DragEvent) => void;
  children: ReactNode;
}) {
  const visible = list.filter((d) => !isMasked(d));
  const hidden = list.length - visible.length;
  const total = list.length === 0 ? (canSeeValues ? "KES 0" : "Values hidden") : visible.length ? `${kes(visible.reduce((a, d) => a + (dealValue(d) ?? 0), 0))}${hidden ? ` · ${hidden} hidden` : ""}` : "Values hidden";
  return (
    <div
      className="fb-dcol"
      data-kind={stage.isWon ? "won" : stage.isLost ? "lost" : "open"}
      data-over={over || undefined}
      data-dragging={dragging || undefined}
      role="group"
      aria-label={`${stage.name}, ${list.length} deal${list.length === 1 ? "" : "s"}`}
      onDragOver={onOver}
      onDragLeave={onLeave}
      onDrop={onDrop}
    >
      <div className="fb-dcol__head">
        <span className="fb-dcol__dot" style={{ background: stageTone(stage) }} aria-hidden="true" />
        <strong className="fb-dcol__name">{stage.name}</strong>
        <span className="fb-dcol__n">{list.length}</span>
      </div>
      <div className="fb-dcol__total">{total}</div>
      <div className="fb-dcol__cards">
        {children}
        {list.length === 0 ? <div className="fb-dcol__empty">{emptyText}</div> : null}
      </div>
    </div>
  );
}

function DealCard({
  d,
  orgSlug,
  zone,
  movable,
  dragging,
  flags,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  d: DealItem;
  orgSlug: string;
  zone: string | null;
  movable: boolean;
  dragging: boolean;
  flags: Flag[];
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onMove: () => void;
}) {
  const v = dealValue(d);
  const nameOf = useMemberName();
  const owner = nameOf(d.ownerMembershipId);
  return (
    <div className="fb-dcard" draggable={movable} data-movable={movable || undefined} data-dragging={dragging || undefined} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="fb-dcard__top">
        <Link href={`/o/${orgSlug}/deals/${d.id}`} className="fb-dcard__company">
          {d.company.name}
        </Link>
        {movable ? (
          <button type="button" className="fb-dcard__move" aria-label={`Move ${d.company.name} to another stage`} title="Move to…" onClick={onMove}>
            <ArrowLeftRight size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="fb-dcard__title">{dealTitle(d)}</div>
      <div className="fb-dcard__value" data-masked={v === null || undefined}>
        {v === null ? (
          isMasked(d) ? "Values hidden" : "No value yet"
        ) : (
          <>
            <span className="fb-dcard__cur">{d.currency}</span>
            {num(v)}
          </>
        )}
      </div>
      {flags.length ? (
        <div className="fb-dflags">
          {flags.map((f) => {
            const Icon = FLAG_ICON[f.icon];
            return (
              <span key={f.key} className={`fb-dflag ${TONE[f.tone]}`}>
                <Icon size={11} aria-hidden="true" />
                {f.label}
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="fb-dcard__foot">
        <span className="fb-dcard__avatar" aria-hidden="true">{initials(owner)}</span>
        <span className="fb-dcard__owner">{owner}</span>
        <Calendar size={13} aria-hidden="true" />
        <span>{dateLong(d.expectedCloseDate as string | null, zone)}</span>
      </div>
    </div>
  );
}
