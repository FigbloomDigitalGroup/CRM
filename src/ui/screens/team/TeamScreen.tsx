"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import type { TeamAttention, TeamMemberRow, TeamMembersResponse, TeamRange, TeamSummary } from "../../../api/dto/team";
import { canViewTeamPage } from "../../../auth/teamAccess";
import { Avatar, Badge, Button, Card, DataTable, EmptyState, ErrorState, KpiTile, LoadingState, MaskedValue, NoAccess, useApiQuery, useMember, type Column, type SortState } from "@/ui";
import { ago, moneyShort } from "../home/format";
import { Seg } from "../home/kit";
import { TeamDrawer } from "./TeamDrawer";
import { balanceRows, RANGES, rangePhrase, shown, sortParam, STATUS_LABEL, STATUS_TONE } from "./model";

/**
 * Team (P2-15, FIG-1598): who is on the sales team, what each person is doing and who needs help. Everything shown is the API's answer; the
 * screen never counts or masks anything itself. A role that may not open the page gets the explained no-access state, and the API refuses
 * the same role on its own.
 */
export function TeamScreen() {
  const { permissionKeys, roleName } = useMember();
  if (!canViewTeamPage(permissionKeys)) {
    return (
      <div className="fb-team" data-screen-label="Team">
        <h1 className="fb-team__title">Team</h1>
        <NoAccess area="Team" denial={{ yourRole: roleName, ownerRoles: ["Management"], whoToAsk: ["Your Management lead"] }} />
      </div>
    );
  }
  return <TeamPage />;
}

type Value = { amount: string | null; masked: boolean };
const dealsWonText = (v: Value) => (v.amount === null ? "—" : moneyShort(v.amount));
const ValueText = ({ value }: { value: Value }) => (value.masked ? <MaskedValue /> : <>{value.amount === null ? "—" : moneyShort(value.amount)}</>);

function TeamPage() {
  const { orgSlug } = useMember();
  const base = `/o/${orgSlug}`;
  const [range, setRange] = useState<TeamRange>("7d");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const summary = useApiQuery("getTeamSummary", { params: { orgSlug }, query: { range } });
  const attention = useApiQuery("getTeamAttention", { params: { orgSlug } });
  const members = useApiQuery(
    "listTeamMembers",
    { params: { orgSlug }, query: { range, ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status: status as "ACTIVE" | "INACTIVE" | "PENDING" } : {}), sort: sortParam(sort), page: String(page), pageSize: "25" } },
    { placeholderData: (prev) => prev },
  );

  const s = summary.data as TeamSummary | undefined;
  const list = members.data as TeamMembersResponse | undefined;
  const att = attention.data as TeamAttention | undefined;
  const filtered = Boolean(q || role || status);

  const columns: Column<TeamMemberRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Member",
        alwaysVisible: true,
        sortValue: (m) => m.name,
        cell: (m) => (
          <button type="button" className="fb-team__person" onClick={() => setOpen(m.membershipId)} aria-label={`Open ${m.name}`}>
            <Avatar name={m.name} src={m.avatarUrl} size={28} />
            <span>{m.name}</span>
          </button>
        ),
      },
      { key: "role", header: "Role", sortValue: (m) => m.role.name, cell: (m) => m.role.name },
      { key: "status", header: "Status", sortValue: (m) => m.status, cell: (m) => <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{STATUS_LABEL[m.status] ?? m.status}</Badge> },
      { key: "lastActive", header: "Last active", sortValue: (m) => m.lastActiveAt, cell: (m) => (m.lastActiveAt ? ago(m.lastActiveAt) : "No activity"), align: "right" },
      { key: "openLeads", header: "Open leads", sortValue: (m) => m.openLeads, cell: (m) => shown(m.openLeads), align: "right" },
      { key: "openDeals", header: "Open deals", sortValue: (m) => m.openDeals, cell: (m) => shown(m.openDeals), align: "right" },
      { key: "tasksToday", header: "Due today", sortValue: (m) => m.tasksDueToday, cell: (m) => shown(m.tasksDueToday), align: "right" },
      { key: "overdueTasks", header: "Overdue", sortValue: (m) => m.overdueTasks, cell: (m) => <span data-late={(m.overdueTasks ?? 0) > 0 || undefined}>{shown(m.overdueTasks)}</span>, align: "right" },
      { key: "newLeads", header: `New leads (${RANGES.find((r) => r.id === range)?.label.toLowerCase()})`, sortValue: (m) => m.newLeads, cell: (m) => shown(m.newLeads), align: "right" },
    ],
    [range],
  );

  const upper = (t: string) => `${t[0]!.toUpperCase()}${t.slice(1)}`;
  const tiles: { label: string; value: React.ReactNode; hint?: string }[] = s
    ? [
        { label: "Members active", value: `${s.summary.membersActive} of ${s.summary.membersTotal}`, hint: `Recorded a CRM action ${rangePhrase(range)}` },
        { label: "Open leads", value: shown(s.summary.openLeads), hint: "Owned, not converted or lost" },
        { label: "Open deals", value: shown(s.summary.openDeals), hint: "Open, not archived" },
        { label: "Overdue tasks", value: shown(s.summary.overdueTasks) },
        { label: "New leads", value: shown(s.summary.newLeads), hint: upper(`${rangePhrase(range)}`) },
        { label: "Deals won", value: shown(s.summary.dealsWon.count), hint: upper(rangePhrase(range)) },
      ]
    : [];

  return (
    <div className="fb-team" data-screen-label="Team">
      <div className="fb-team__head">
        <div>
          <h1 className="fb-team__title">Team</h1>
          <div className="fb-team__meta">
            <span className="fb-team__scope"><span className="fb-team__scope__dot" />Organisation{s ? ` · ${s.summary.membersTotal}` : ""}</span>
            <span className="fb-team__hint">Who is on the sales team, what each person is doing and who needs help.</span>
          </div>
        </div>
        <Seg label="Date range" value={range} onChange={(r) => { setRange(r); setPage(1); }} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
      </div>

      {summary.isLoading ? <LoadingState label="Loading the team summary" /> : null}
      {summary.isError ? <ErrorState error={summary.error} area="Team" onRetry={() => void summary.refetch()} /> : null}
      {s ? (
        <section aria-label="Team summary" className="fb-team__kpis">
          {tiles.map((t) => (
            <KpiTile key={t.label} label={t.label} value={t.value} trend={t.hint} />
          ))}
          <KpiTile label="Open deal value" value={<ValueText value={s.summary.openDealsValue} />} trend={`Won ${rangePhrase(range)}: ${s.summary.dealsWon.value.masked ? "hidden" : dealsWonText(s.summary.dealsWon.value)}`} />
        </section>
      ) : null}

      <div className="fb-team__two">
        {s ? (
          <Card title="Workload balance">
            <p className="fb-team__note">Open leads per person. A hint to look, not a rule: nothing is reassigned from here.</p>
            {s.access.leads ? (
              <>
                <ul className="fb-team__bars">
                  {balanceRows(s.workload).slice(0, 12).map((r) => (
                    <li key={r.membershipId}>
                      <button type="button" className="fb-team__barname" onClick={() => setOpen(r.membershipId)}>{r.name}</button>
                      <span className="fb-team__bar" aria-hidden="true"><span style={{ width: `${r.width}%` }} data-flag={r.flag ?? undefined} /></span>
                      <span className="fb-team__barn">
                        {r.openLeads}
                        {r.flag === "high" ? <Badge tone="warning">Heavy</Badge> : r.flag === "idle" ? <Badge tone="neutral">None</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="fb-team__pool">
                  <Link href={`${base}/leads?view=unassigned`}>{shown(s.summary.unassignedLeads)} unassigned {s.summary.unassignedLeads === 1 ? "lead" : "leads"} in the shared pool</Link>
                </p>
              </>
            ) : (
              <p className="fb-team__note">Your role cannot see leads.</p>
            )}
          </Card>
        ) : null}

        <Card title="Needs attention">
          {attention.isLoading ? <LoadingState label="Loading" /> : null}
          {attention.isError ? <ErrorState error={attention.error} area="Needs attention" onRetry={() => void attention.refetch()} /> : null}
          {att ? (
            <div className="fb-team__attn">
              <AttnList
                title={`Leads with no activity for ${att.staleDays} days`}
                total={att.staleLeads?.total ?? null}
                empty="Every open lead has had activity."
                rows={att.staleLeads?.items.map((l) => ({ key: l.id, href: `${base}/leads/${l.id}`, label: l.company ?? l.contact ?? "Lead", meta: `${l.ownerName ?? "Unassigned"} · last touched ${ago(l.lastTouchAt)}` }))}
              />
              <AttnList
                title="Overdue tasks"
                total={att.overdueTasks?.total ?? null}
                empty="No overdue tasks."
                rows={att.overdueTasks?.items.map((t) => ({ key: t.id, href: `${base}/tasks`, label: t.title, meta: `${t.ownerName ?? ""} · due ${ago(t.dueAt)}` }))}
              />
              <AttnList
                title="Stuck deals"
                total={att.stuckDeals?.total ?? null}
                empty="No deal is stuck."
                rows={att.stuckDeals?.items.map((d) => ({ key: d.id, href: `${base}/deals/${d.id}`, label: d.company ?? "Deal", meta: `${d.ownerName ?? ""} · ${d.stage} · quiet ${d.daysQuiet} days`, value: d.value }))}
              />
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="Members">
        <div className="fb-team__filters" role="search" aria-label="Filter team members">
          <div className="fb-team__search">
            <span className="fb-team__search__icon" aria-hidden="true"><Search size={16} /></span>
            <input className="fb-team__input" type="search" aria-label="Search team members" placeholder="Search name or email" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <select className="fb-team__select" aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {(list?.roles ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
          <select className="fb-team__select" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Invited</option>
            <option value="INACTIVE">Suspended</option>
          </select>
          {filtered ? <button type="button" className="fb-team__clear" onClick={() => { setText(""); setQ(""); setRole(""); setStatus(""); setPage(1); }}>Clear</button> : null}
        </div>

        {members.isError ? <ErrorState error={members.error} area="Team members" onRetry={() => void members.refetch()} /> : null}
        {!members.isError && list ? (
          list.items.length === 0 && !members.isFetching ? (
            <EmptyState
              icon={<Users size={20} />}
              title={filtered ? "No one matches these filters" : "No team members yet"}
              body={filtered ? "Try another name, role or status." : "Invite people in Members settings and they appear here."}
              action={filtered ? undefined : <Link className="fb-btn fb-btn--secondary" href={`${base}/settings?tab=members`}>Open Members settings</Link>}
            />
          ) : (
            <>
              <div className="fb-team__table">
                <DataTable
                  caption="Team members"
                  columns={columns}
                  rows={list.items}
                  rowKey={(m) => m.membershipId}
                  loading={members.isFetching && list.items.length === 0}
                  sort={sort}
                  onSortChange={(next) => { setSort(next); setPage(1); }}
                  onRowClick={(m) => setOpen(m.membershipId)}
                />
              </div>
              <ul className="fb-team__cards" aria-label="Team members">
                {list.items.map((m) => (
                  <li key={m.membershipId} className="fb-team__mcard">
                    <button type="button" className="fb-team__person" onClick={() => setOpen(m.membershipId)} aria-label={`Open ${m.name}`}>
                      <Avatar name={m.name} src={m.avatarUrl} size={36} />
                      <span><strong>{m.name}</strong><br /><span className="fb-team__sub">{m.role.name} · {STATUS_LABEL[m.status] ?? m.status}</span></span>
                    </button>
                    <dl className="fb-team__facts">
                      <div><dt>Open leads</dt><dd>{shown(m.openLeads)}</dd></div>
                      <div><dt>Open deals</dt><dd>{shown(m.openDeals)}</dd></div>
                      <div><dt>Due today</dt><dd>{shown(m.tasksDueToday)}</dd></div>
                      <div><dt>Overdue</dt><dd>{shown(m.overdueTasks)}</dd></div>
                    </dl>
                    <span className="fb-team__sub">{m.lastActiveAt ? `Last active ${ago(m.lastActiveAt)}` : "No recorded activity"}</span>
                  </li>
                ))}
              </ul>
              <nav className="fb-team__pager" aria-label="Members pages">
                <Button variant="secondary" size="sm" disabled={list.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <span aria-live="polite">Page {list.page} of {list.pageCount} · {list.total} {list.total === 1 ? "person" : "people"}</span>
                <Button variant="secondary" size="sm" disabled={!list.nextCursor} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </nav>
            </>
          )
        ) : null}
        {members.isLoading ? <LoadingState label="Loading members" /> : null}
      </Card>

      <TeamDrawer membershipId={open} range={range} onClose={() => setOpen(null)} />
    </div>
  );
}

function AttnList({ title, total, rows, empty }: { title: string; total: number | null; empty: string; rows?: { key: string; href: string; label: string; meta: string; value?: Value }[] }) {
  return (
    <div>
      <h3 className="fb-team__h3">{title}{total !== null ? <span className="fb-team__count"> {total}</span> : null}</h3>
      {total === null ? (
        <p className="fb-team__note">Your role cannot see this.</p>
      ) : rows && rows.length > 0 ? (
        <ul className="fb-team__list">
          {rows.slice(0, 5).map((r) => (
            <li key={r.key}>
              <Link href={r.href}>{r.label}</Link>
              <span className="fb-team__when">{r.meta}</span>
              {r.value ? <span className="fb-team__when"><ValueText value={r.value} /></span> : null}
            </li>
          ))}
          {total > 5 ? <li className="fb-team__note">and {total - 5} more</li> : null}
        </ul>
      ) : (
        <p className="fb-team__note">{empty}</p>
      )}
    </div>
  );
}
