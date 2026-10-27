"use client";

import { ArrowLeft, ArrowLeftRight, Archive, CheckCircle2, Clock, Mail, MessageCircle, Package, Phone, StickyNote, Users, Zap, BellRing, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi, useApiQuery } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { useMember } from "../../data/member";
import { ErrorState } from "../../components/states";
import { useToast } from "../../components/toast";
import { explainRollback } from "../../data/hooks";
import { AddProposalDialog, AddTaskDrawer, LogActivityDrawer } from "./DealDrawers";
import { useMemberName, useRefData, useRefreshDeals } from "./data";
import { ago, dateLong, dateShort, initials, kes, stageTone, when, type DealDetail, type HandoffView, type Stage } from "./model";
import { useDealMover } from "./useDealMover";

/**
 * F2.05 / P2: one deal. The stage stepper (every move goes through the same checks as the board), the summary, the proposals, the timeline,
 * the delivery handoff, the primary contact and the tasks. Value and anything else the API masks is never shown or worked out here; an
 * archived deal is read-only until it is restored; a proposal with no answer shows a follow-up reminder that can be snoozed (FIG-795).
 */

interface ProposalRow {
  id: string;
  proposalNumber: string;
  status: string;
  amount: string | null;
  currency: string;
  sentAt?: string | null;
  respondedAt?: string | null;
  documentReference?: string | null;
  updatedAt: string;
  amountMasked: boolean;
}
interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  description: string;
  occurredAt: string;
  outcome: string;
  authorMembershipId: string | null;
}
interface TaskRow {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
  assigneeName?: string;
}

const STATUSES = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", VIEWED: "Viewed", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "Expired" };
const ACT_ICON: Record<string, LucideIcon> = { CALL: Phone, WHATSAPP: MessageCircle, EMAIL: Mail, MEETING: Users, NOTE: StickyNote, OTHER: Zap };
const COMMS = ["CALL", "WHATSAPP", "EMAIL", "MEETING"];
const HANDOFF_LABEL: Record<string, string> = { AWAITING_OWNER: "Needs an owner", ONBOARDING: "Onboarding", DELIVERED: "Delivered" };
const DAY = 86_400_000;

type Drawer = null | "log" | "task" | "proposal";

export function DealDetailScreen({ dealId }: { dealId: string }) {
  const member = useMember();
  const { can, orgSlug } = member;
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const ref = useRefData();
  const nameOf = useMemberName();
  const mover = useDealMover(ref.data);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [tab, setTab] = useState<"all" | "comms" | "audit">("all");
  const [now] = useState(() => new Date());

  const deal = useApiQuery("getDeal", { params: { orgSlug, dealId } }, { retry: false });
  const d = deal.data as unknown as (DealDetail & { primaryContact: { id: string; firstName: string; lastName?: string; jobTitle?: string; phone?: string } | null }) | undefined;
  const proposalsQ = useApiQuery("getDealsByDealIdProposals", { params: { orgSlug, dealId } }, { enabled: can("proposals.view"), retry: false });
  const activitiesQ = useApiQuery("getActivities", { params: { orgSlug }, query: { dealId, pageSize: "50" } as never }, { enabled: can("activities.view"), retry: false });
  const tasksQ = useApiQuery("getTasks", { params: { orgSlug }, query: { dealId } }, { enabled: can("tasks.view.own") || can("tasks.view.all"), retry: false });
  const handoffQ = useApiQuery("getDealsByDealIdHandoff", { params: { orgSlug, dealId } }, { enabled: d?.outcome === "WON", retry: false });
  const auditQ = useApiQuery("listAuditLog", { params: { orgSlug }, query: { entityType: "Deal", entityId: dealId, pageSize: "50" } }, { enabled: tab === "audit" && can("audit.view"), retry: false });
  const reminderQ = useApiQuery("getReminderSettings", { params: { orgSlug } }, { enabled: can("organization.manage_settings"), retry: false });

  const proposals = (proposalsQ.data as unknown as ProposalRow[] | undefined) ?? [];
  const activities = ((activitiesQ.data as unknown as { items?: ActivityRow[] } | undefined)?.items ?? []) as ActivityRow[];
  const tasks = (((tasksQ.data as unknown as { items?: TaskRow[] } | undefined)?.items ?? []) as TaskRow[]).filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const handoff = (handoffQ.data as unknown as { handoff: HandoffView | null } | undefined)?.handoff ?? null;
  const reminderDays = (reminderQ.data as unknown as { proposalFollowUp?: { enabled: boolean; days: number } } | undefined)?.proposalFollowUp;

  const stages = ref.data?.stages ?? [];
  const stage = stages.find((s) => s.id === d?.pipelineStageId) as Stage | undefined;

  if (deal.isLoading || ref.isLoading) return <DetailSkeleton />;
  if (deal.error || !d) {
    return (
      <div className="fb-deals">
        <BackLink orgSlug={orgSlug} label="Deals" />
        <div className="fb-dstate">
          <ErrorState error={deal.error} area="This deal" onRetry={() => void deal.refetch()} />
        </div>
      </div>
    );
  }

  const archived = Boolean(d.archivedAt);
  const owns = d.ownerMembershipId === member.membershipId;
  const mayEdit = can("deals.edit.all") || (can("deals.edit.own") && owns);
  const editable = mayEdit && !archived;
  const mayArchive = can("deals.archive.all") || (can("deals.archive.own") && owns);
  const open = d.outcome === "OPEN";
  const valueHidden = d.valueMasked || d.value === null;
  const value = valueHidden ? null : Number(d.value);
  const valueText = d.valueMasked ? "Values hidden" : value === null ? "No value yet" : kes(value, d.currency);
  const readOnlyRole = !can("deals.view.all") && !can("deals.view.own") && can("deals.view.won");
  const scope = editable ? (can("deals.edit.all") ? { tone: "org", label: "Organisation" } : { tone: "own", label: "Own" }) : { tone: "ro", label: "Read-only" };
  const company = d.company;
  const title = (typeof d.notes === "string" && d.notes.split(/\r?\n/)[0]!.trim()) || d.service?.name || "Deal";
  const lastProposal = proposals[0];
  const sentDays = lastProposal?.sentAt ? Math.floor((now.getTime() - new Date(lastProposal.sentAt).getTime()) / DAY) : null;
  const followDays = reminderDays?.days ?? 5;
  const snoozedUntil = tasks.find((t) => /^Follow up on proposal/i.test(t.title) && t.dueAt && new Date(t.dueAt) > now);
  const reminderOn = (reminderDays?.enabled ?? true) && open && !archived && lastProposal?.status === "SENT" && sentDays !== null && sentDays >= followDays;

  const target = { id: d.id, company: company.name, stageId: d.pipelineStageId, outcome: d.outcome, title, valueLabel: valueText };

  async function archiveDeal() {
    try {
      await api.call("postDealsByDealIdArchive", { params: { orgSlug, dealId }, body: {}, idempotencyKey: newIdempotencyKey() });
      refresh();
      toast.show({
        message: `${company.name} deal archived.`,
        undo: async () => {
          try {
            await api.call("postDealsByDealIdRestore", { params: { orgSlug, dealId }, idempotencyKey: newIdempotencyKey() });
            refresh();
          } catch (e) {
            toast.show({ tone: "danger", message: explainRollback(e, "Restoring the deal") });
          }
        },
      });
    } catch (e) {
      toast.show({ tone: "danger", message: explainRollback(e, "Archiving the deal") });
    }
  }
  async function restoreDeal() {
    try {
      await api.call("postDealsByDealIdRestore", { params: { orgSlug, dealId }, idempotencyKey: newIdempotencyKey() });
      refresh();
      toast.show({ tone: "success", message: "Deal restored." });
    } catch (e) {
      toast.show({ tone: "danger", message: explainRollback(e, "Restoring the deal") });
    }
  }
  async function reassign(ownerMembershipId: string) {
    try {
      await api.call("postDealsByDealIdAssign", { params: { orgSlug, dealId }, body: { ownerMembershipId }, idempotencyKey: newIdempotencyKey() });
      refresh();
      toast.show({ tone: "success", message: `Owner changed to ${nameOf(ownerMembershipId)}.` });
    } catch (e) {
      toast.show({ tone: "danger", message: explainRollback(e, "Changing the owner") });
    }
  }
  async function snooze(days: number) {
    const dueAt = new Date(now.getTime() + days * DAY);
    dueAt.setHours(10, 0, 0, 0);
    try {
      await api.call("postTasks", { params: { orgSlug }, body: { title: `Follow up on proposal ${lastProposal?.proposalNumber ?? ""}`.trim(), dealId, dueAt: dueAt.toISOString() }, idempotencyKey: newIdempotencyKey() });
      refresh();
      toast.show({ tone: "success", message: `Snoozed. We’ll put a follow-up task on your list for ${dateShort(dueAt.toISOString(), member.timeZone)}.` });
    } catch (e) {
      toast.show({ tone: "danger", message: explainRollback(e, "Snoozing the reminder") });
    }
  }
  async function setProposalStatus(p: ProposalRow, status: string) {
    try {
      await api.call("patchDealsByDealIdProposalsByProposalId", { params: { orgSlug, dealId, proposalId: p.id }, body: { status: status as never } });
      refresh();
      toast.show({ tone: "success", message: `${p.proposalNumber} marked ${STATUS_LABEL[status]?.toLowerCase() ?? status}.` });
    } catch (e) {
      toast.show({ tone: "danger", message: explainRollback(e, "Changing the proposal status") });
    }
  }

  const facts: { k: string; v: string; col?: string; href?: string }[] = [
    { k: "COMPANY", v: company.name, href: can("companies.view") ? `/o/${orgSlug}/companies/${company.id}` : undefined },
    { k: "SERVICE", v: d.service?.name ?? "—" },
    { k: "OWNER", v: nameOf(d.ownerMembershipId) },
    { k: "VALUE", v: valueText, col: value === null ? "var(--text-3)" : undefined },
    { k: "EXPECTED CLOSE", v: dateLong(d.expectedCloseDate, member.timeZone), col: open && d.signals?.closeDatePassed ? "var(--red)" : undefined },
    { k: "CREATED", v: dateLong(d.createdAt, member.timeZone) },
    { k: "LAST ACTIVITY", v: ago(d.lastActivityAt) },
  ];
  if (d.lostReason) facts.push({ k: "LOST REASON", v: d.lostReason.name, col: "var(--red)" });
  if (stage?.key === "PROPOSAL_SENT" && lastProposal?.sentAt && sentDays !== null) {
    const replied = lastProposal.respondedAt;
    facts.push({ k: "PROPOSAL RESPONSE", v: replied ? "Customer replied" : `No reply · ${sentDays} days`, col: replied ? "var(--primary-text)" : sentDays >= followDays ? "var(--orange-text)" : undefined });
  }

  const comms = activities.filter((a) => COMMS.includes(a.type));
  const timeline = tab === "comms" ? comms : activities;
  const auditItems = ((auditQ.data as unknown as { items?: { id: string; at: string; action: string; actor?: { name?: string } | null; previousValue?: Record<string, unknown> | null; newValue?: Record<string, unknown> | null }[] } | undefined)?.items ?? []);
  const stageName = (id: unknown) => stages.find((s) => s.id === id)?.name ?? "another stage";
  const describeAudit = (a: (typeof auditItems)[number]) => {
    if (a.action === "deal.moved") return `Moved from ${String(a.previousValue?.stage ?? "—")} to ${String(a.newValue?.stage ?? "—")}`;
    if (a.action === "deal.updated" && a.newValue?.pipelineStageId) return `Stage changed from ${stageName(a.previousValue?.pipelineStageId)} to ${stageName(a.newValue.pipelineStageId)}`;
    return a.action.replace(/^deal\./, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
  };

  const showStalled = open && !archived && d.signals?.stalled;
  const members = ref.data?.members ?? [];
  const tabs: { id: "all" | "comms" | "audit"; label: string }[] = [
    { id: "all", label: "Activity" },
    { id: "comms", label: "Communications" },
    ...(can("audit.view") ? [{ id: "audit" as const, label: "Audit history" }] : []),
  ];

  return (
    <div className="fb-deals fb-ddetail" data-screen-label="Deal detail">
      <BackLink orgSlug={orgSlug} label={readOnlyRole ? "Won deals" : "Deals"} />

      {archived ? (
        <div className="fb-dnotice fb-dnotice--neutral" role="status">
          <Archive size={17} aria-hidden="true" />
          <span className="fb-dnotice__text">
            <strong>Archived.</strong> This deal is read-only until it’s restored.
          </span>
          {mayArchive ? (
            <button type="button" className="fb-dnotice__btn fb-dnotice__btn--solid" onClick={() => void restoreDeal()}>
              Restore
            </button>
          ) : null}
        </div>
      ) : null}
      {showStalled ? (
        <div className="fb-dnotice fb-dnotice--warn" role="status">
          <Clock size={17} aria-hidden="true" />
          <span className="fb-dnotice__text">
            <strong>Stalled: no activity for {d.signals!.daysSinceActivity} days.</strong> It stays in {d.pipelineStage.name} until someone moves it.
          </span>
          {editable && can("activities.create") ? (
            <button type="button" className="fb-dnotice__btn" onClick={() => setDrawer("log")}>
              Log activity
            </button>
          ) : null}
        </div>
      ) : null}
      {reminderOn && lastProposal ? (
        snoozedUntil ? (
          <div className="fb-dnotice fb-dnotice--info" role="status">
            <BellRing size={17} aria-hidden="true" />
            <span className="fb-dnotice__text">
              <strong>Follow-up snoozed.</strong> Proposal {lastProposal.proposalNumber} has had no answer for {sentDays} days. Your task “{snoozedUntil.title}” is due {dateShort(snoozedUntil.dueAt, member.timeZone)}.
            </span>
          </div>
        ) : (
          <div className="fb-dnotice fb-dnotice--info" role="status" aria-label="Proposal follow-up reminder">
            <BellRing size={17} aria-hidden="true" />
            <span className="fb-dnotice__text">
              <strong>No answer to proposal {lastProposal.proposalNumber} for {sentDays} days.</strong> A follow-up may help. Figbloom only reminds; it never sends anything for you.
            </span>
            {editable ? (
              <span className="fb-dnotice__actions">
                {can("activities.create") ? (
                  <button type="button" className="fb-dnotice__btn" onClick={() => setDrawer("log")}>
                    Log a follow-up
                  </button>
                ) : null}
                <label className="fb-dnotice__snooze">
                  <span className="fb-sr-only">Snooze the reminder</span>
                  <select
                    aria-label="Snooze the reminder"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void snooze(Number(e.target.value));
                    }}
                  >
                    <option value="">Snooze…</option>
                    <option value="1">Tomorrow</option>
                    <option value="3">In 3 days</option>
                    <option value="7">Next week</option>
                  </select>
                </label>
              </span>
            ) : null}
          </div>
        )
      ) : null}

      <div className="fb-ddetail__head">
        <div>
          <div className="fb-ddetail__titlerow">
            <h1 className="fb-deals__h1">{company.name}</h1>
            <span className="fb-dstagepill">
              <span className="fb-dstage__dot" style={{ background: stage ? stageTone(stage) : "var(--text-3)" }} aria-hidden="true" />
              {d.pipelineStage.name}
            </span>
          </div>
          <div className="fb-ddetail__line">
            {title} · <strong style={{ color: value === null ? "var(--text-3)" : "var(--text)" }}>{valueText}</strong>
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="fb-dscope" data-tone={scope.tone}>
              <span className="fb-dscope__dot" aria-hidden="true" />
              {scope.label}
            </span>
          </div>
        </div>
        {editable ? (
          <div className="fb-deals__tools">
            {can("activities.create") ? (
              <button type="button" className="fb-dtool" onClick={() => setDrawer("log")}>
                <Phone size={16} aria-hidden="true" />
                Log activity
              </button>
            ) : null}
            <button type="button" className="fb-dtool" onClick={() => mover.openMoveTo(target)}>
              <ArrowLeftRight size={16} aria-hidden="true" />
              Move to…
            </button>
            {mayArchive ? (
              <button type="button" className="fb-dtool fb-dtool--icon" aria-label="Archive" title="Archive" onClick={() => void archiveDeal()}>
                <Archive size={16} aria-hidden="true" />
              </button>
            ) : null}
            {open ? (
              <button type="button" className="fb-dtool fb-dtool--primary" onClick={() => { const won = stages.find((s) => s.isWon); if (won) void mover.requestMove(target, won.id); }}>
                <CheckCircle2 size={16} aria-hidden="true" />
                Mark won
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <section aria-label="Deal stages" className="fb-dsteps">
        <ol className="fb-dsteps__row">
          {stages.map((s) => {
            const current = s.id === d.pipelineStageId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="fb-dstep"
                  data-current={current || undefined}
                  data-kind={s.isWon ? "won" : s.isLost ? "lost" : "open"}
                  disabled={!editable || current}
                  aria-current={current ? "step" : undefined}
                  onClick={() => void mover.requestMove(target, s.id)}
                >
                  {s.name}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="fb-dsteps__note">Figbloom never moves a deal on its own. Won opens the Delivery handoff; Lost asks for a reason.</div>
      </section>

      <div className="fb-ddetail__grid">
        <div className="fb-ddetail__main">
          <section className="fb-dcardbox" aria-labelledby="fb-deal-summary">
            <h2 id="fb-deal-summary" className="fb-dcardbox__h">Summary</h2>
            <dl className="fb-dfacts">
              {facts.map((f) => (
                <div key={f.k}>
                  <dt>{f.k}</dt>
                  <dd style={f.col ? { color: f.col } : undefined}>{f.href ? <Link href={f.href} className="fb-dlink">{f.v}</Link> : f.v}</dd>
                </div>
              ))}
            </dl>
            {can("deals.edit.all") && !archived ? (
              <label className="fb-downer">
                <span>Owner</span>
                <select value={d.ownerMembershipId} onChange={(e) => void reassign(e.target.value)}>
                  {members.map((m) => (
                    <option key={m.membershipId} value={m.membershipId}>
                      {m.userName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </section>

          {can("proposals.view") && !proposalsQ.error ? (
            <section className="fb-dcardbox fb-dcardbox--flush" aria-labelledby="fb-deal-proposals">
              <div className="fb-dcardbox__bar">
                <h2 id="fb-deal-proposals" className="fb-dcardbox__h fb-dcardbox__h--bare">Proposals</h2>
                {editable && can("proposals.manage") ? (
                  <button type="button" className="fb-dlinkbtn" onClick={() => setDrawer("proposal")}>
                    + Add proposal reference
                  </button>
                ) : null}
              </div>
              <div className="fb-dtablescroll">
                  <table className="fb-dtable fb-dtable--tight">
                    <caption className="fb-sr-only">Proposals on this deal</caption>
                    <thead>
                      <tr>
                        {["NUMBER", "STATUS", "AMOUNT", "SENT", "RESPONDED", "DOCUMENT"].map((c) => (
                          <th key={c} scope="col">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {proposals.map((p) => (
                        <tr key={p.id}>
                          <td className="fb-dmono">{p.proposalNumber}</td>
                          <td>
                            {editable && can("proposals.manage") ? (
                              <select className="fb-dstatus" aria-label={`Status of ${p.proposalNumber}`} value={p.status} onChange={(e) => void setProposalStatus(p, e.target.value)}>
                                {STATUSES.map((s) => (
                                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="fb-dstatuspill">{STATUS_LABEL[p.status] ?? p.status}</span>
                            )}
                          </td>
                          <td style={{ fontWeight: 600, color: p.amountMasked || p.amount === null ? "var(--text-3)" : undefined }}>{p.amountMasked || p.amount === null ? "Hidden" : kes(Number(p.amount), p.currency)}</td>
                          <td className="fb-dmuted">{dateShort(p.sentAt, member.timeZone)}</td>
                          <td className="fb-dmuted">{dateShort(p.respondedAt, member.timeZone)}</td>
                          <td className="fb-dpath">{p.documentReference ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              </div>
              {proposals.length === 0 ? <div className="fb-dcardbox__empty">No proposals yet. Documents live in Drive; store the reference here.</div> : null}
            </section>
          ) : null}

          {can("activities.view") ? (
            <section className="fb-dcardbox fb-dcardbox--flush" aria-label="Timeline">
              <div className="fb-dtabsbar">
                <div className="fb-dseg fb-dseg--plain" role="group" aria-label="Timeline view">
                  {tabs.map((t) => (
                    <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fb-dtl">
                {tab === "audit" ? (
                  auditItems.length ? (
                    auditItems.map((a) => (
                      <TimelineRow key={a.id} Icon={Zap} text={describeAudit(a)} by={a.actor?.name ?? "Figbloom automation"} at={when(a.at, member.timeZone, member.hour12)} />
                    ))
                  ) : (
                    <div className="fb-dtl__empty">{auditQ.isLoading ? "Loading…" : "Nothing logged yet."}</div>
                  )
                ) : timeline.length ? (
                  timeline.map((a) => (
                    <TimelineRow
                      key={a.id}
                      Icon={ACT_ICON[a.type] ?? Zap}
                      comm={COMMS.includes(a.type)}
                      text={[a.subject, a.description].filter(Boolean).join(" — ") || "Activity"}
                      by={a.authorMembershipId ? nameOf(a.authorMembershipId) : "Figbloom automation"}
                      at={when(a.occurredAt, member.timeZone, member.hour12)}
                    />
                  ))
                ) : (
                  <div className="fb-dtl__empty">{activitiesQ.isLoading ? "Loading…" : "Nothing logged yet."}</div>
                )}
              </div>
            </section>
          ) : null}
        </div>

        <div className="fb-ddetail__side">
          {handoff ? (
            <section className="fb-dcardbox" aria-labelledby="fb-deal-handoff">
              <div className="fb-dhand__head">
                <span className="fb-dhand__icon"><Package size={17} aria-hidden="true" /></span>
                <h2 id="fb-deal-handoff" className="fb-dcardbox__h fb-dcardbox__h--bare" style={{ flex: 1 }}>Delivery handoff</h2>
                <span className="fb-dhand__status">{HANDOFF_LABEL[handoff.status] ?? handoff.status}</span>
              </div>
              <dl className="fb-dhand__facts">
                <dt>Owner</dt>
                <dd>{handoff.deliveryOwner?.name ?? "Not assigned yet"}</dd>
                <dt>Starts</dt>
                <dd>{dateLong(handoff.startDate, member.timeZone)}</dd>
              </dl>
              {handoff.scope ? <p className="fb-dhand__scope">{handoff.scope}</p> : null}
              {can("handoff.manage") ? (
                <Link href={`/o/${orgSlug}/handoffs?deal=${d.id}`} className="fb-dtool fb-dtool--sm">
                  Open delivery view
                </Link>
              ) : null}
            </section>
          ) : null}

          {d.primaryContact ? (
            <section className="fb-dcardbox" aria-labelledby="fb-deal-contact">
              <h2 id="fb-deal-contact" className="fb-dmonohead">PRIMARY CONTACT</h2>
              <div className="fb-dcontact">
                <span className="fb-dcontact__avatar" aria-hidden="true">{initials(`${d.primaryContact.firstName} ${d.primaryContact.lastName ?? ""}`)}</span>
                <div>
                  {can("contacts.view") ? (
                    <Link href={`/o/${orgSlug}/contacts/${d.primaryContact.id}`} className="fb-dcontact__name">
                      {d.primaryContact.firstName} {d.primaryContact.lastName}
                    </Link>
                  ) : (
                    <span className="fb-dcontact__name">
                      {d.primaryContact.firstName} {d.primaryContact.lastName}
                    </span>
                  )}
                  <div className="fb-dmuted fb-dcontact__job">{d.primaryContact.jobTitle ?? ""}</div>
                </div>
              </div>
              {d.primaryContact.phone ? <div className="fb-dcontact__phone">{d.primaryContact.phone}</div> : null}
              {can("activities.create") && d.primaryContact.phone ? (
                <div className="fb-dcontact__actions">
                  <a className="fb-dcontact__btn fb-dcontact__btn--solid" href={`tel:${d.primaryContact.phone}`}>
                    <Phone size={15} aria-hidden="true" />
                    Call
                  </a>
                  <a className="fb-dcontact__btn" href={`https://wa.me/${d.primaryContact.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                    <MessageCircle size={15} aria-hidden="true" />
                    WhatsApp
                  </a>
                </div>
              ) : null}
            </section>
          ) : null}

          {can("tasks.view.own") || can("tasks.view.all") ? (
            <section className="fb-dcardbox fb-dcardbox--flush" aria-labelledby="fb-deal-tasks">
              <div className="fb-dcardbox__bar fb-dcardbox__bar--tight">
                <h2 id="fb-deal-tasks" className="fb-dcardbox__h fb-dcardbox__h--bare">Tasks</h2>
                {editable && can("tasks.create") ? (
                  <button type="button" className="fb-dlinkbtn" onClick={() => setDrawer("task")}>
                    + Add task
                  </button>
                ) : null}
              </div>
              {tasks.map((t) => {
                const overdue = t.dueAt ? new Date(t.dueAt) < now : false;
                return (
                  <div key={t.id} className="fb-dtask">
                    <span className="fb-dtask__dot" style={{ background: overdue ? "var(--red)" : "var(--text-3)" }} aria-hidden="true" />
                    <div>
                      <div className="fb-dtask__title">{t.title}</div>
                      <div className="fb-dtask__meta" style={{ color: overdue ? "var(--red)" : "var(--text-2)" }}>
                        {overdue ? <span className="fb-sr-only">Overdue: </span> : null}
                        {t.dueAt ? `${overdue ? "Overdue · " : ""}${when(t.dueAt, member.timeZone, member.hour12)}` : "No date"} · {t.assigneeName ?? ""}
                      </div>
                    </div>
                  </div>
                );
              })}
              {tasks.length === 0 ? <div className="fb-dcardbox__empty fb-dcardbox__empty--small">No tasks.</div> : null}
            </section>
          ) : null}
        </div>
      </div>

      {mover.host}
      {drawer === "log" ? <LogActivityDrawer dealId={dealId} onClose={() => setDrawer(null)} /> : null}
      {drawer === "task" ? <AddTaskDrawer dealId={dealId} onClose={() => setDrawer(null)} /> : null}
      {drawer === "proposal" ? <AddProposalDialog dealId={dealId} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}

function BackLink({ orgSlug, label }: { orgSlug: string; label: string }) {
  return (
    <Link href={`/o/${orgSlug}/deals`} className="fb-dback">
      <ArrowLeft size={15} aria-hidden="true" />
      {label}
    </Link>
  );
}

function TimelineRow({ Icon, text, by, at, comm }: { Icon: LucideIcon; text: string; by: string; at: string; comm?: boolean }) {
  return (
    <div className="fb-dtl__row">
      <span className="fb-dtl__icon" data-comm={comm || undefined}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <div style={{ flex: 1 }}>
        <div className="fb-dtl__text">{text}</div>
        <div className="fb-dtl__meta">
          {by} · {at}
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="fb-deals" role="status" aria-busy="true">
      <span className="fb-sr-only">Loading the deal</span>
      <div className="fb-dskel" style={{ height: 36, width: 260 }} />
      <div className="fb-dskel" style={{ height: 56 }} />
      <div className="fb-dskel" style={{ height: 280 }} />
    </div>
  );
}

