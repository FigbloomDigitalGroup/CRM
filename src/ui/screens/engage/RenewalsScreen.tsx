"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { describeError } from "../../errors";
import { ErrorState, LoadingState, MaskedValue, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useFormatters, useReference } from "../leads/data";
import { Icon } from "../leads/icons";
import { DealModal } from "../deals/Modal";
import { QuickLogDialog, type LogTarget } from "./Dialogs";
import { plural } from "./data";

/** What the retention lists carry per row (src/services/retentionService.ts is the source; the contract types them loosely). */
interface RetentionItem {
  companyId: string;
  companyName: string;
  list: string;
  reason: string;
  ownerMembershipId: string | null;
  quietDays: number | null;
  proposal: { id: string; number: string; daysSinceSent: number; dealId: string } | null;
  suggestions: { serviceId: string; serviceName: string; similarCustomers: number }[];
}
interface Thresholds {
  dormancyDays: number;
  goingQuietFromDays: number;
  proposalFollowUpDays: number;
  dueWithinDays: number;
  graceDays: number;
}
interface ServiceRow {
  id: string;
  companyId: string;
  companyName: string;
  serviceId?: string;
  serviceName: string;
  billingCycle: "MONTHLY" | "QUARTERLY" | "YEARLY";
  value: string | null;
  valueMasked: boolean;
  currency?: string;
  renewsOn: string;
  daysToRenewal: number;
  state: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED";
  ownerMembershipId?: string | null;
}

const CYCLE: Record<string, { label: string; per: string }> = {
  MONTHLY: { label: "Monthly", per: "/ mo" },
  QUARTERLY: { label: "Quarterly", per: "/ qtr" },
  YEARLY: { label: "Yearly", per: "/ yr" },
};
const DORMANT_CHOICES = [60, 90, 120, 180];
const DAY = 86_400_000;

function stateText(r: ServiceRow): { text: string; hot: boolean } {
  const d = r.daysToRenewal;
  switch (r.state) {
    case "LAPSED":
      return { text: `Lapsed ${plural(Math.abs(d), "day")} ago`, hot: true };
    case "DUE_SOON":
      return { text: d < 0 ? `Due ${plural(-d, "day")} ago (grace period)` : d === 0 ? "Renews today" : `Due in ${plural(d, "day")}`, hot: true };
    case "STARTS_LATER":
      return { text: "Starts later", hot: false };
    case "CANCELLED":
      return { text: "Cancelled", hot: false };
    default:
      return { text: "Active", hot: false };
  }
}

type Chip = "ALL" | "DUE_SOON" | "LAPSED";

/**
 * Renewals and retention (E2, FIG-1099): the recurring services and when they renew, customers going quiet, proposals nobody answered and
 * cross-sell ideas. It only reminds: nothing here changes a record until a person acts, and every action goes through the API with the
 * owner the API reports (a task goes to the record's owner, not to whoever clicked).
 */
export function RenewalsScreen() {
  const member = useMember();
  const { orgSlug, can, membershipId, userName } = member;
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormatters();
  const ref = useReference();
  const [chip, setChip] = useState<Chip>("ALL");
  const [made, setMade] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<{ target: LogTarget; who: string; channel: "CALL" | "WHATSAPP" } | null>(null);
  const [dealFor, setDealFor] = useState<ServiceRow | null>(null);

  const base = { params: { orgSlug } };
  const retQ = useApiQuery("getRenewalsAndRetention", { ...base, query: { pageSize: "50" } });
  const svcQ = useApiQuery("listRecurringServices", { ...base, query: { pageSize: "50" } });
  const settingsQ = useApiQuery("getRenewalSettings", base);
  const org = can("reporting.view.all");
  const repeatQ = useApiQuery("getReportsCustomers", { ...base, query: { pageSize: "1" } }, { enabled: org });

  const createTask = useApiMutation("postTasks");
  const setDormancy = useApiMutation("putReportsSettings", {
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["getRenewalsAndRetention"] });
      void qc.invalidateQueries({ queryKey: ["getReportsCustomers"] });
      toast.show({ tone: "success", message: `Customers now go dormant after ${r.dormancyDays} days. Going quiet starts at ${Math.floor(r.dormancyDays / 2)}. Lifecycle never changes on its own here; the daily check applies it.` });
    },
    onError: (e) => toast.show({ tone: "danger", message: describeError(e).body }),
  });

  if (retQ.isError && !retQ.data) {
    const d = describeError(retQ.error);
    if (d.kind === "noAccess") return <NoAccess area="Renewals and retention" denial={d.denial} />;
    return <ErrorState error={retQ.error} area="Renewals and retention" onRetry={() => void retQ.refetch()} />;
  }
  if (!retQ.data) {
    return (
      <div className="fb-en-page" data-screen-label="Renewals and retention">
        <h1 className="fb-en-title">Renewals &amp; retention</h1>
        <LoadingState label="Loading renewals and retention" lines={6} />
      </div>
    );
  }

  const ret = retQ.data as unknown as { scope: "organisation" | "own"; counts: Record<string, number>; lists: Record<string, { items: RetentionItem[]; total: number }>; thresholds: Thresholds };
  const counts = ret.counts;
  const th = ret.thresholds;
  const items = (k: string) => ret.lists[k]?.items ?? [];
  const totalOf = (k: string) => ret.lists[k]?.total ?? 0;
  const orgWide = ret.scope === "organisation";
  const remindDays = (settingsQ.data as { dueSoonDays?: number } | undefined)?.dueSoonDays ?? th.dueWithinDays;
  const canTask = can("tasks.create");
  const canLog = can("activities.create") && can("communications.create");

  const ownerName = (id: string | null | undefined) => (!id ? "Unassigned" : id === membershipId ? `${userName} (you)` : (ref.memberName(id) ?? "Team member"));
  const taskOwner = (id: string | null | undefined) => id || membershipId;

  async function addTask(key: string, body: { title: string; dueAt: string; companyId: string; assigneeMembershipId: string }, assigneeLabel: string) {
    try {
      await createTask.mutateAsync({ params: { orgSlug }, body: { ...body, priority: "MEDIUM" } });
      setMade((s) => new Set(s).add(key));
      void qc.invalidateQueries({ queryKey: ["getTasks"] });
      toast.show({ tone: "success", message: `Task added for ${assigneeLabel}: ${body.title}` });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    }
  }

  const services = ((svcQ.data?.items ?? []) as unknown as ServiceRow[]).slice().sort((a, b) => a.renewsOn.localeCompare(b.renewsOn));
  const shown = services.filter((s) => (chip === "ALL" ? true : s.state === chip));
  const chipCount = (c: Chip) => (c === "ALL" ? services.length : services.filter((s) => s.state === c).length);

  const dueValue = services.filter((s) => s.state === "DUE_SOON" || s.state === "LAPSED");
  const unmasked = dueValue.length > 0 && dueValue.every((s) => !s.valueMasked && s.value !== null);
  const repeat = (repeatQ.data as { summary?: { repeat?: number } } | undefined)?.summary?.repeat;
  const kpis = [
    { l: "Renewals due", n: counts.DUE_30 ?? 0, sub: counts.LAPSED ? `${counts.LAPSED} already lapsed` : unmasked ? `${dueValue.length} up for renewal` : `within ${th.dueWithinDays} days`, icon: "refresh", bg: "var(--purple-soft)", fg: "var(--purple)" },
    { l: "Going quiet", n: counts.GOING_QUIET ?? 0, sub: `no contact in ${th.goingQuietFromDays}+ days`, icon: "clock", bg: "var(--orange-soft)", fg: "var(--orange-text)" },
    { l: "Proposals unanswered", n: counts.UNANSWERED_PROPOSALS ?? 0, sub: `sent ${th.proposalFollowUpDays}+ days ago`, icon: "send", bg: "var(--blue-soft)", fg: "var(--blue)" },
    org && repeat !== undefined
      ? { l: "Repeat customers", n: repeat, sub: "2 or more won deals", icon: "check-circle", bg: "var(--primary-soft)", fg: "var(--primary-text)" }
      : { l: "Cross-sell ideas", n: counts.CROSS_SELL ?? 0, sub: "services similar customers use", icon: "check-circle", bg: "var(--primary-soft)", fg: "var(--primary-text)" },
  ];

  const dormantChoices = DORMANT_CHOICES.includes(th.dormancyDays) ? DORMANT_CHOICES : [...DORMANT_CHOICES, th.dormancyDays].sort((a, b) => a - b);
  const canSetDormancy = can("organization.manage_settings");

  return (
    <div className="fb-en-page" data-screen-label="Renewals and retention">
      <div>
        <h1 className="fb-en-title">Renewals &amp; retention</h1>
        <p className="fb-en-sub">Keep customers after the first sale: renewals coming up, customers going quiet, and proposals nobody answered.</p>
        <div className="fb-en-scoperow">
          <span className={`fb-en-scope fb-en-scope--${orgWide ? "org" : "own"}`}>
            <span className="fb-en-scope__dot" aria-hidden="true" />
            {orgWide ? "All customers" : "Customers you own"}
          </span>
          <span className="fb-en-hint">Reminders only. Nothing here changes a record until you act.</span>
        </div>
      </div>

      <div className="fb-en-kpis">
        {kpis.map((k) => (
          <div className="fb-en-kpi" key={k.l}>
            <div className="fb-en-kpi__top">
              <span className="fb-en-kpi__l">{k.l}</span>
              <span className="fb-en-kpi__ico" style={{ background: k.bg, color: k.fg }}>
                <Icon name={k.icon} size={17} />
              </span>
            </div>
            <div className="fb-en-kpi__n">{k.n}</div>
            <div className="fb-en-kpi__sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <section className="fb-en-card" aria-labelledby="fb-en-renew-h">
        <div className="fb-en-sechead">
          <h2 id="fb-en-renew-h">Recurring services and renewals</h2>
          <div className="fb-en-secsub">Hosting, maintenance, retainers and data plans. You’re reminded {remindDays} days before each renewal.</div>
          <div className="fb-en-chips" role="group" aria-label="Show">
            {(
              [
                ["ALL", "All"],
                ["DUE_SOON", "Due soon"],
                ["LAPSED", "Lapsed"],
              ] as [Chip, string][]
            ).map(([id, label]) => (
              <button type="button" key={id} className="fb-en-chip" data-on={chip === id} aria-pressed={chip === id} onClick={() => setChip(id)}>
                {label} <span>{chipCount(id)}</span>
              </button>
            ))}
          </div>
        </div>
        {svcQ.isError ? (
          <div className="fb-en-empty fb-en-empty--row" role="alert">
            {describeError(svcQ.error).body}
          </div>
        ) : svcQ.isLoading ? (
          <div className="fb-en-pad">
            <LoadingState label="Loading recurring services" lines={3} />
          </div>
        ) : shown.length === 0 ? (
          <div className="fb-en-empty fb-en-empty--row">{services.length === 0 ? "No recurring services yet. Hosting, maintenance and retainers appear here once they are set up on a customer." : "Nothing in this view."}</div>
        ) : (
          <div className="fb-en-tablewrap">
            <table className="fb-en-table" aria-label="Recurring services and renewals">
              <thead>
                <tr>
                  {["CUSTOMER", "SERVICE", "CYCLE", "VALUE", "RENEWS", "OWNER"].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="fb-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const st = stateText(r);
                  const cycle = CYCLE[r.billingCycle] ?? CYCLE.YEARLY!;
                  const key = `svc:${r.id}`;
                  const owner = taskOwner(r.ownerMembershipId);
                  const due = new Date(Math.max(Date.now() + DAY, new Date(r.renewsOn).getTime() - 14 * DAY)).toISOString();
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link className="fb-en-link" href={`/o/${orgSlug}/companies/${r.companyId}`}>
                          {r.companyName}
                        </Link>
                      </td>
                      <td>{r.serviceName}</td>
                      <td className="fb-en-muted">{cycle.label}</td>
                      <td className="fb-en-strong">{r.valueMasked || r.value === null ? <MaskedValue /> : `${r.currency ?? "KES"} ${Number(r.value).toLocaleString("en-KE")} ${cycle.per}`}</td>
                      <td>
                        <div className="fb-en-strong">{fmt.date(r.renewsOn)}</div>
                        <div className="fb-en-state" data-hot={st.hot}>
                          {st.text}
                        </div>
                      </td>
                      <td className="fb-en-muted">{ownerName(r.ownerMembershipId)}</td>
                      <td className="fb-en-actions">
                        <span className="fb-en-actions__in">
                          {canTask ? (
                            <button
                              type="button"
                              className="fb-en-btn fb-en-btn--secondary fb-en-btn--xs"
                              disabled={made.has(key) || createTask.isPending}
                              aria-label={`Add follow-up for ${r.companyName} ${r.serviceName}`}
                              onClick={() => void addTask(key, { title: `Renewal: confirm ${r.serviceName} with ${r.companyName}`, dueAt: due, companyId: r.companyId, assigneeMembershipId: owner }, ownerName(owner))}
                            >
                              {made.has(key) ? "Follow-up added" : "Add follow-up"}
                            </button>
                          ) : null}
                          {can("deals.create") ? (
                            <button type="button" className="fb-en-btn fb-en-btn--primary fb-en-btn--xs" aria-label={`Start renewal deal for ${r.companyName} ${r.serviceName}`} onClick={() => setDealFor(r)}>
                              Start renewal deal
                            </button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="fb-en-grid">
        <section className="fb-en-card" aria-labelledby="fb-en-quiet-h">
          <div className="fb-en-sechead">
            <h2 id="fb-en-quiet-h">Going quiet</h2>
            <div className="fb-en-secsub fb-en-secsub--row">
              No logged contact for {th.goingQuietFromDays} days or more. Customers become dormant after
              <select
                className="fb-en-select fb-en-select--xs"
                aria-label="Dormant after (days)"
                value={String(th.dormancyDays)}
                disabled={!canSetDormancy || setDormancy.isPending}
                onChange={(e) => setDormancy.mutate({ params: { orgSlug }, body: { dormancyDays: Number(e.target.value) } })}
              >
                {dormantChoices.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              days. {canSetDormancy ? "Flags only; lifecycle never changes on its own." : "Management sets this."}
            </div>
          </div>
          {items("GOING_QUIET").map((c) => {
            const key = `quiet:${c.companyId}`;
            const owner = taskOwner(c.ownerMembershipId);
            return (
              <div className="fb-en-item" key={c.companyId}>
                <span className="fb-en-ico fb-en-ico--sm" style={{ background: "var(--orange-soft)", color: "var(--orange-text)" }}>
                  <Icon name="clock" size={16} />
                </span>
                <div className="fb-en-item__main">
                  <Link className="fb-en-link fb-en-link--ink" href={`/o/${orgSlug}/companies/${c.companyId}`}>
                    {c.companyName}
                  </Link>
                  <div className="fb-en-faint">
                    {c.quietDays !== null ? `No contact for ${plural(c.quietDays, "day")}` : c.reason} · {ownerName(c.ownerMembershipId)}
                  </div>
                </div>
                <div className="fb-en-item__acts">
                  {canLog ? (
                    <button type="button" className="fb-en-btn fb-en-btn--ghost fb-en-btn--xs" aria-label={`Log contact with ${c.companyName}`} onClick={() => setLog({ target: { companyId: c.companyId }, who: c.companyName, channel: "CALL" })}>
                      Log contact
                    </button>
                  ) : null}
                  {canTask ? (
                    <button
                      type="button"
                      className="fb-en-btn fb-en-btn--secondary fb-en-btn--xs"
                      disabled={made.has(key) || createTask.isPending}
                      aria-label={`Plan a check-in with ${c.companyName}`}
                      onClick={() => void addTask(key, { title: `Check in with ${c.companyName}`, dueAt: new Date(Date.now() + 2 * DAY).toISOString(), companyId: c.companyId, assigneeMembershipId: owner }, ownerName(owner))}
                    >
                      {made.has(key) ? "Check-in planned" : "Plan a check-in"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {items("GOING_QUIET").length === 0 ? <div className="fb-en-empty fb-en-empty--row">No one has gone quiet.</div> : null}
          {totalOf("GOING_QUIET") > items("GOING_QUIET").length ? <div className="fb-en-more">Showing {items("GOING_QUIET").length} of {totalOf("GOING_QUIET")}.</div> : null}
        </section>

        <section className="fb-en-card" aria-labelledby="fb-en-chase-h">
          <div className="fb-en-sechead">
            <h2 id="fb-en-chase-h">Proposals waiting for a reply</h2>
            <div className="fb-en-secsub">Sent {th.proposalFollowUpDays}+ days ago with no response logged since.</div>
          </div>
          {items("UNANSWERED_PROPOSALS").map((p) => (
            <div className="fb-en-item" key={p.companyId}>
              <span className="fb-en-ico fb-en-ico--sm" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
                <Icon name="send" size={16} />
              </span>
              <div className="fb-en-item__main">
                <Link className="fb-en-link fb-en-link--ink" href={`/o/${orgSlug}${p.proposal ? `/deals/${p.proposal.dealId}` : `/companies/${p.companyId}`}`}>
                  {p.companyName}
                </Link>
                <div className="fb-en-faint">
                  {p.proposal?.number ?? "Proposal"} · sent {p.proposal ? `${plural(p.proposal.daysSinceSent, "day")} ago` : "recently"} · {ownerName(p.ownerMembershipId)}
                </div>
              </div>
              {p.proposal ? <span className="fb-en-days">{plural(p.proposal.daysSinceSent, "day")}</span> : null}
              {canLog && p.proposal ? (
                <button type="button" className="fb-en-btn fb-en-btn--primary fb-en-btn--xs" aria-label={`Chase ${p.companyName}`} onClick={() => setLog({ target: { dealId: p.proposal!.dealId }, who: p.companyName, channel: "WHATSAPP" })}>
                  <Icon name="whatsapp" size={13} />
                  Chase
                </button>
              ) : null}
            </div>
          ))}
          {items("UNANSWERED_PROPOSALS").length === 0 ? <div className="fb-en-empty fb-en-empty--row">No proposals waiting.</div> : null}
          {totalOf("UNANSWERED_PROPOSALS") > items("UNANSWERED_PROPOSALS").length ? <div className="fb-en-more">Showing {items("UNANSWERED_PROPOSALS").length} of {totalOf("UNANSWERED_PROPOSALS")}.</div> : null}
        </section>

        <section className="fb-en-card" aria-labelledby="fb-en-upsell-h">
          <div className="fb-en-sechead">
            <h2 id="fb-en-upsell-h">Cross-sell ideas</h2>
            <div className="fb-en-secsub">Customers and the services similar customers use that they don’t yet. Suggestions, not tasks.</div>
          </div>
          {items("CROSS_SELL").map((u) => (
            <div className="fb-en-item" key={u.companyId}>
              <div className="fb-en-item__main">
                <Link className="fb-en-link fb-en-link--ink" href={`/o/${orgSlug}/companies/${u.companyId}`}>
                  {u.companyName}
                </Link>
                <div className="fb-en-faint">{u.reason}</div>
              </div>
              <div className="fb-en-ideas">
                {u.suggestions.map((s) => (
                  <span className="fb-en-idea" key={s.serviceId} title={`${plural(s.similarCustomers, "similar customer")} use it`}>
                    {s.serviceName}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {items("CROSS_SELL").length === 0 ? <div className="fb-en-empty fb-en-empty--row">No ideas right now.</div> : null}
          {totalOf("CROSS_SELL") > items("CROSS_SELL").length ? <div className="fb-en-more">Showing {items("CROSS_SELL").length} of {totalOf("CROSS_SELL")}.</div> : null}
        </section>
      </div>

      {log ? <QuickLogDialog target={log.target} who={log.who} channel={log.channel} chooseChannel onClose={() => setLog(null)} onDone={() => void qc.invalidateQueries({ queryKey: ["getRenewalsAndRetention"] })} /> : null}
      {dealFor ? <RenewalDealDialog row={dealFor} onClose={() => setDealFor(null)} /> : null}
    </div>
  );
}

/** "Start renewal deal": an open deal in the first open stage, owned by the person starting it, due when the service renews. */
function RenewalDealDialog({ row, onClose }: { row: ServiceRow; onClose: () => void }) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const qc = useQueryClient();
  const refQ = useApiQuery("getReferenceData", { params: { orgSlug } }, { staleTime: 5 * 60_000 });
  const stage = [...(refQ.data?.pipelineStages ?? [])].filter((s) => s.isActive && !s.isWon && !s.isLost).sort((a, b) => a.sequence - b.sequence)[0];
  const [notes, setNotes] = useState(`Renewal of ${row.serviceName}.`);
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation("postDeals", {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["listDeals"] });
      toast.show({ tone: "success", message: `Renewal deal started for ${row.companyName}. Find it on the Deals board.` });
      onClose();
    },
    onError: (e) => setError(describeError(e).body),
  });
  return (
    <DealModal
      title="Start a renewal deal"
      lead={`${row.companyName} · ${row.serviceName}. An open deal you own, expected to close when the service renews.`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fb-btn fb-btn--primary fb-dm__btn"
            disabled={!stage || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({
                params: { orgSlug },
                body: { companyId: row.companyId, pipelineStageId: stage!.id, ...(row.serviceId ? { serviceId: row.serviceId } : {}), expectedCloseDate: row.renewsOn.slice(0, 10), ...(notes.trim() ? { notes: notes.trim() } : {}) },
              });
            }}
          >
            Start deal
          </button>
        </>
      }
    >
      <label className="fb-dm__field">
        <span>Notes</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {refQ.isSuccess && !stage ? <p className="fb-dm__error">This organisation has no open pipeline stage to start a deal in.</p> : null}
      {error ? <p className="fb-dm__error" role="alert">{error}</p> : null}
    </DealModal>
  );
}
