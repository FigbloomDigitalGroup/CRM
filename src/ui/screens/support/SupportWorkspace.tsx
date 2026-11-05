"use client";

import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { Badge, KpiTile } from "../../components/basics";
import { Tabs } from "../../components/overlays";
import { EmptyState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, usePatchTicket, useSurveyList, useTicketList, useWhen, type Ticket } from "./api";
import { SupportQueryState } from "./SupportState";

/** Who may use the workspace: the ticket permission of the proposed Customer Support role (docs/DECISIONS.md 2.4). */
export function useSupportAccess() {
  const { can } = useMember();
  return can("tickets.manage");
}

/**
 * The Customer Support workspace (FIG-1178, the design's "Support" home): the ticket list with the status changed in place, and the satisfaction
 * answers. Reads the ticket and survey routes (FIG-1155). A proposed role behind the `customer_support.role` toggle: with it off the API answers
 * FEATURE_UNAVAILABLE and the screen explains it.
 */
export function SupportWorkspace() {
  const allowed = useSupportAccess();
  const { roleName } = useMember();
  if (!allowed) {
    return (
      <div className="fb-sup">
        <h1 className="fb-sup__title">Support</h1>
        <NoAccess area="Support" denial={{ yourRole: roleName, ownerRoles: ["Customer Support", "Management"], whoToAsk: ["Management"] }} />
      </div>
    );
  }
  return <SupportBody />;
}

function SupportBody() {
  const { orgSlug } = useMember();
  const toast = useToast();
  const when = useWhen();
  const ticketsQ = useTicketList();
  const surveysQ = useSurveyList();
  const patch = usePatchTicket();
  const tickets: Ticket[] = ticketsQ.data?.items ?? [];
  const answered = (surveysQ.data?.items ?? []).filter((s) => s.status === "ANSWERED" && s.score !== null);
  const avg = surveysQ.data?.summary.averageScore;
  // Survey answers carry the customer's id only; the ticket list already holds the names.
  const companyName = (id: string) => tickets.find((t) => t.company.id === id)?.company.name ?? "Customer";
  const open = tickets.filter((t) => t.status === "OPEN").length;
  const waiting = tickets.filter((t) => t.status === "WAITING_ON_CLIENT").length;

  function setStatus(t: Ticket, status: string) {
    patch.mutate(
      { params: { orgSlug, ticketId: t.id }, body: { status } },
      {
        onSuccess: () => toast.show({ message: `Ticket marked ${STATUS_LABEL[status]}` }),
        onError: (e) => toast.show({ tone: "danger", message: describeError(e).body }),
      },
    );
  }

  const list = (
    <section className="fb-sup__card" aria-label="Tickets">
      <h2 className="fb-sup__h2">Tickets</h2>
      <SupportQueryState query={ticketsQ} area="Tickets">
        {tickets.length === 0 ? (
          <EmptyState icon={<LifeBuoy size={22} />} title="No tickets yet" body="Maintenance requests from customers will appear here." />
        ) : (
          tickets.map((t) => (
            <div key={t.id} className="fb-sup__row">
              <span className="fb-sup__icon" aria-hidden="true">
                <LifeBuoy size={16} />
              </span>
              <div className="fb-sup__main">
                <Link className="fb-sup__link" href={`/o/${orgSlug}/support/${t.id}`}>
                  {t.title}
                </Link>
                <div className="fb-sup__meta">
                  #{t.number} · <Link href={`/o/${orgSlug}/support/customers/${t.company.id}`}>{t.company.name}</Link> · opened {when(t.createdAt)} ·{" "}
                  {PRIORITY_LABEL[t.priority] ?? t.priority} priority
                </div>
              </div>
              <label className="fb-sup__status">
                <span className="fb-sr-only">Ticket status for {t.title}</span>
                <select className="fb-input" value={t.status} onChange={(e) => setStatus(t, e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))
        )}
      </SupportQueryState>
    </section>
  );

  const satisfaction = (
    <section className="fb-sup__card" aria-label="Satisfaction survey answers">
      <h2 className="fb-sup__h2">Satisfaction survey answers</h2>
      <SupportQueryState query={surveysQ} area="Satisfaction answers">
        {answered.length === 0 ? (
          <EmptyState title="No answers yet" body="Answers appear after a customer completes the short survey." />
        ) : (
          answered.map((s) => (
            <div key={s.id} className="fb-sup__row">
              <span className="fb-sup__score" data-low={(s.score ?? 0) <= 3 || undefined} aria-label={`Score ${s.score} out of 5`}>
                {s.score}
              </span>
              <div className="fb-sup__main">
                <Link className="fb-sup__link" href={`/o/${orgSlug}/support/customers/${s.companyId}`}>
                  {companyName(s.companyId)}
                </Link>
                <div className="fb-sup__meta">
                  {s.comment ? `“${s.comment}” · ` : ""}
                  {when(s.sentAt)}
                </div>
              </div>
              {(s.score ?? 0) <= 3 ? <Badge tone="warning">Follow up</Badge> : <Badge tone="success">Happy</Badge>}
            </div>
          ))
        )}
      </SupportQueryState>
    </section>
  );

  return (
    <div className="fb-sup" data-screen-label="Support workspace">
      <div className="fb-sup__head">
        <div>
          <h1 className="fb-sup__title">Support</h1>
          <p className="fb-sup__sub">Maintenance clients and open tickets</p>
        </div>
      </div>
      <div className="fb-sup__kpis">
        <KpiTile label="Open tickets" value={open} trend="need a first response" />
        <KpiTile label="Waiting on client" value={waiting} trend="nothing to do yet" />
        <KpiTile label="Satisfaction" value={avg === null || avg === undefined ? "–" : avg.toFixed(1)} trend={`out of 5, from ${answered.length} answers`} />
      </div>
      <Tabs
        label="Support"
        tabs={[
          { id: "tickets", label: "Tickets", panel: list },
          { id: "satisfaction", label: "Satisfaction", panel: satisfaction },
        ]}
      />
    </div>
  );
}
