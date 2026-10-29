"use client";

import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { Badge, Button, KpiTile } from "../../components/basics";
import { Tabs } from "../../components/overlays";
import { EmptyState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { DEMO_CUSTOMERS, type TicketStatus } from "./demo/data";
import { supportDemo, useTickets } from "./demo/store";

const STATUSES: TicketStatus[] = ["Open", "Waiting on client", "Resolved"];
const companyName = (id: string) => DEMO_CUSTOMERS.find((c) => c.id === id)?.name ?? "Customer";

/** Who may use the workspace: the ticket permission of the proposed Customer Support role (docs/DECISIONS.md 2.4). */
export function useSupportAccess() {
  const { can } = useMember();
  return can("tickets.manage");
}

/**
 * The Customer Support workspace (FIG-1178, the design's "Support" home): open tickets, waiting-on-client, my tasks; the ticket list with the
 * status changed in place; and the satisfaction answers. A proposed role (decision-gated, waived for the demo): the note says so, as in the
 * design. On demo data; when B6.23 is cancelled this issue is cancelled with it.
 */
export function SupportWorkspace() {
  const allowed = useSupportAccess();
  const { roleName, orgSlug } = useMember();
  const tickets = useTickets();
  const toast = useToast();

  if (!allowed) {
    return (
      <div className="fb-sup">
        <h1 className="fb-sup__title">Support</h1>
        <NoAccess area="Support" denial={{ yourRole: roleName, ownerRoles: ["Customer Support", "Management"], whoToAsk: ["Management"] }} />
      </div>
    );
  }

  const open = tickets.filter((t) => t.status === "Open").length;
  const waiting = tickets.filter((t) => t.status === "Waiting on client").length;
  const surveys = supportDemo.surveys();
  const avg = surveys.length ? (surveys.reduce((a, s) => a + s.score, 0) / surveys.length).toFixed(1) : "–";

  const list = (
    <section className="fb-sup__card" aria-label="Tickets">
      <h2 className="fb-sup__h2">Tickets</h2>
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
                <Link href={`/o/${orgSlug}/support/customers/${t.companyId}`}>{companyName(t.companyId)}</Link> · opened {t.opened} · {t.priority} priority
              </div>
            </div>
            <label className="fb-sup__status">
              <span className="fb-sr-only">Ticket status for {t.title}</span>
              <select
                className="fb-input"
                value={t.status}
                onChange={(e) => {
                  supportDemo.setStatus(t.id, e.target.value as TicketStatus);
                  toast.show({ message: `Ticket marked ${e.target.value}` });
                }}
              >
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        ))
      )}
    </section>
  );

  const satisfaction = (
    <section className="fb-sup__card" aria-label="Satisfaction survey answers">
      <h2 className="fb-sup__h2">Satisfaction survey answers</h2>
      {surveys.length === 0 ? (
        <EmptyState title="No answers yet" body="Answers appear after a customer completes the short survey." />
      ) : (
        surveys.map((s) => (
          <div key={s.id} className="fb-sup__row">
            <span className="fb-sup__score" data-low={s.score <= 6 || undefined} aria-label={`Score ${s.score} out of 10`}>
              {s.score}
            </span>
            <div className="fb-sup__main">
              <Link className="fb-sup__link" href={`/o/${orgSlug}/support/customers/${s.companyId}`}>
                {companyName(s.companyId)}
              </Link>
              <div className="fb-sup__meta">
                “{s.comment}” · {s.at}
              </div>
            </div>
            {s.score <= 6 ? <Badge tone="warning">Follow up</Badge> : <Badge tone="success">Happy</Badge>}
          </div>
        ))
      )}
    </section>
  );

  return (
    <div className="fb-sup" data-screen-label="Support workspace">
      <div className="fb-sup__head">
        <div>
          <h1 className="fb-sup__title">Support</h1>
          <p className="fb-sup__sub">Maintenance clients and open tickets</p>
        </div>
        <Button variant="primary" onClick={() => toast.show({ message: "Opens the log-a-note drawer on the customer you pick." })}>
          Log a note
        </Button>
      </div>
      
      <div className="fb-sup__kpis">
        <KpiTile label="Open tickets" value={open} trend="need a first response" />
        <KpiTile label="Waiting on client" value={waiting} trend="nothing to do yet" />
        <KpiTile label="Satisfaction" value={avg} trend={`from ${surveys.length} answers`} />
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
