"use client";

import Link from "next/link";
import type { TeamMemberDetail } from "../../../api/dto/team";
import { Avatar, Badge, Drawer, ErrorState, LoadingState, MaskedValue, EmptyState, useApiQuery, useMember } from "@/ui";
import { ago, dueLabel, money } from "../home/format";
import { rangePhrase, shown, STATUS_LABEL, STATUS_TONE, trendHeights } from "./model";

type Detail = TeamMemberDetail;
type Value = { amount: string | null; masked: boolean };

function ValueText({ value }: { value: Value }) {
  if (value.masked) return <MaskedValue />;
  return <>{value.amount === null ? "No value" : money(value.amount)}</>;
}

/**
 * One member's detail (P2-15): recent sales activity from the audit trail, open leads and deals with links, tasks and a 30-day trend. Actions
 * are for Management: each lead links to its page, where it can be reassigned, and the member's account is managed in Settings. Nothing here
 * changes anything by itself.
 */
export function TeamDrawer({ membershipId, range, onClose }: { membershipId: string | null; range: "today" | "7d" | "30d"; onClose: () => void }) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getTeamMember", { params: { orgSlug, membershipId: membershipId ?? "" }, query: { range } }, { enabled: !!membershipId });
  const base = `/o/${orgSlug}`;
  const d = q.data as Detail | undefined;
  return (
    <Drawer
      open={!!membershipId}
      onClose={onClose}
      title={d ? d.member.name : "Team member"}
      footer={
        <Link className="fb-btn fb-btn--secondary" href={`${base}/settings?tab=members`}>
          Open in Members settings
        </Link>
      }
    >
      <div className="fb-team__drawer">
        {q.isLoading ? <LoadingState label="Loading this person" /> : null}
        {q.isError ? <ErrorState error={q.error} area="This team member" onRetry={() => void q.refetch()} /> : null}
        {d ? (
          <>
            <div className="fb-team__who">
              <Avatar name={d.member.name} src={d.member.avatarUrl} size={48} />
              <div>
                <div className="fb-team__name">{d.member.name}</div>
                <div className="fb-team__sub">
                  {d.member.role.name} · <Badge tone={STATUS_TONE[d.member.status] ?? "neutral"}>{STATUS_LABEL[d.member.status] ?? d.member.status}</Badge>
                </div>
                <div className="fb-team__sub">{d.member.email}</div>
              </div>
            </div>

            <dl className="fb-team__facts">
              <div><dt>Open leads</dt><dd>{shown(d.member.openLeads)}</dd></div>
              <div><dt>Open deals</dt><dd>{shown(d.member.openDeals)}</dd></div>
              <div><dt>Tasks due today</dt><dd>{shown(d.member.tasksDueToday)}</dd></div>
              <div><dt>Overdue tasks</dt><dd>{shown(d.member.overdueTasks)}</dd></div>
              <div><dt>New leads {rangePhrase(range)}</dt><dd>{shown(d.member.newLeads)}</dd></div>
              <div><dt>Last active</dt><dd>{d.member.lastActiveAt ? ago(d.member.lastActiveAt) : "No recorded activity"}</dd></div>
            </dl>

            <section aria-labelledby="team-trend">
              <h3 id="team-trend" className="fb-team__h3">Activity, last 30 days</h3>
              <div className="fb-team__trend" role="img" aria-label={`${d.trend.reduce((n, t) => n + t.count, 0)} recorded actions over the last 30 days`}>
                {trendHeights(d.trend).map((t) => (
                  <span key={t.start} className="fb-team__trendbar" style={{ height: `${t.height}%` }} title={`${new Date(t.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${t.count}`} />
                ))}
              </div>
              <p className="fb-team__note">Only actions the CRM already records on leads, deals, tasks, contacts and companies. Nothing else is tracked.</p>
            </section>

            <section aria-labelledby="team-recent">
              <h3 id="team-recent" className="fb-team__h3">Recent activity</h3>
              {d.recentActivity.length === 0 ? (
                <p className="fb-team__note">No recorded sales activity yet.</p>
              ) : (
                <ul className="fb-team__list">
                  {d.recentActivity.map((e) => (
                    <li key={e.id}>
                      {e.path ? <Link href={`${base}${e.path}`}>{e.label}</Link> : <span>{e.label}</span>}
                      <span className="fb-team__when">{ago(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="team-leads">
              <h3 id="team-leads" className="fb-team__h3">Open leads</h3>
              {d.openLeads === null ? (
                <p className="fb-team__note">Your role cannot see leads.</p>
              ) : d.openLeads.length === 0 ? (
                <p className="fb-team__note">No open leads.</p>
              ) : (
                <ul className="fb-team__list">
                  {d.openLeads.map((l) => (
                    <li key={l.id}>
                      <Link href={`${base}/leads/${l.id}`}>{l.company ?? l.contact ?? "Lead"}</Link>
                      {l.stale ? <Badge tone="warning">Quiet</Badge> : null}
                      <span className="fb-team__when">{l.nextFollowUpAt ? `Follow up ${dueLabel(l.nextFollowUpAt).text}` : "No follow-up set"}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="fb-team__note">To reassign a lead, open it and use Assign.</p>
            </section>

            <section aria-labelledby="team-deals">
              <h3 id="team-deals" className="fb-team__h3">Open deals</h3>
              {d.openDeals === null ? (
                <p className="fb-team__note">Your role cannot see deals.</p>
              ) : d.openDeals.length === 0 ? (
                <p className="fb-team__note">No open deals.</p>
              ) : (
                <ul className="fb-team__list">
                  {d.openDeals.map((x) => (
                    <li key={x.id}>
                      <Link href={`${base}/deals/${x.id}`}>{x.company ?? "Deal"}</Link>
                      <span className="fb-team__when">{x.stage}</span>
                      {x.stuck ? <Badge tone="warning">Stuck</Badge> : null}
                      <span className="fb-team__when"><ValueText value={x.value} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="team-tasks">
              <h3 id="team-tasks" className="fb-team__h3">Open tasks</h3>
              {d.tasks === null ? (
                <p className="fb-team__note">Your role cannot see tasks.</p>
              ) : d.tasks.length === 0 ? (
                <EmptyState title="No open tasks" body="Nothing is waiting on this person." />
              ) : (
                <ul className="fb-team__list">
                  {d.tasks.map((t) => (
                    <li key={t.id}>
                      <span>{t.title}</span>
                      <span className="fb-team__when" data-late={t.overdue || undefined}>{dueLabel(t.dueAt).text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
