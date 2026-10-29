"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button } from "../../components/basics";
import { Textarea } from "../../components/forms";
import { NoAccess, EmptyState } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { DemoNotice } from "../../demo/DemoBadge";
import type { TicketStatus } from "./demo/data";
import { supportDemo, useTickets } from "./demo/store";
import { CustomerSummary } from "./CustomerView";
import { useSupportAccess } from "./SupportWorkspace";

const STATUSES: TicketStatus[] = ["Open", "Waiting on client", "Resolved"];

/** One ticket (FIG-1178): the conversation, an internal-note switch (the customer never sees internal notes), the status, and the role-limited customer beside it. */
export function TicketDetail({ ticketId }: { ticketId: string }) {
  const allowed = useSupportAccess();
  const { orgSlug, roleName, userName } = useMember();
  const tickets = useTickets();
  const toast = useToast();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!allowed) return <NoAccess area="Support" denial={{ yourRole: roleName, ownerRoles: ["Customer Support", "Management"], whoToAsk: ["Management"] }} />;
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) return <EmptyState title="Ticket not found" body="It may have been removed, or the link is wrong." action={<Link href={`/o/${orgSlug}/support`}>Back to Support</Link>} />;
  const customer = supportDemo.customer(ticket.companyId);

  function send() {
    if (!text.trim()) {
      setError("Write a message first");
      return;
    }
    setError(undefined);
    supportDemo.reply(ticket!.id, text.trim(), internal, userName);
    setText("");
    toast.show({ message: internal ? "Internal note added. The customer cannot see it." : "Reply sent to the customer.", tone: "success" });
  }

  return (
    <div className="fb-sup" data-screen-label="Support ticket">
      <Link className="fb-sup__back" href={`/o/${orgSlug}/support`}>
        <ArrowLeft size={15} aria-hidden="true" /> Support
      </Link>
      <div className="fb-sup__head">
        <div>
          <h1 className="fb-sup__title fb-sup__title--sm">{ticket.title}</h1>
          <p className="fb-sup__sub">
            Opened {ticket.opened} · {ticket.priority} priority · owner {ticket.owner}
          </p>
        </div>
        <label className="fb-sup__status">
          <span className="fb-sr-only">Status</span>
          <select
            className="fb-input"
            value={ticket.status}
            onChange={(e) => {
              supportDemo.setStatus(ticket.id, e.target.value as TicketStatus);
              toast.show({ message: `Ticket marked ${e.target.value}` });
            }}
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <DemoNotice what="This ticket" />
      <div className="fb-sup__split">
        <section className="fb-sup__card" aria-label="Conversation">
          <h2 className="fb-sup__h2">Conversation</h2>
          {ticket.thread.map((m, i) => (
            <div key={i} className="fb-sup__msg" data-internal={m.internal || undefined}>
              <div className="fb-sup__msghead">
                <strong>{m.from}</strong> <span>{m.at}</span> {m.internal ? <Badge tone="warning">Internal note</Badge> : null}
              </div>
              <p>{m.text}</p>
            </div>
          ))}
          <Textarea label="Reply" rows={3} value={text} error={error} onChange={(e) => setText(e.target.value)} />
          <label className="fb-sup__check">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (the customer won’t see it)
          </label>
          <div>
            <Button variant="primary" onClick={send}>
              {internal ? "Add note" : "Send reply"}
            </Button>
          </div>
        </section>
        {customer ? <CustomerSummary customer={customer} href={`/o/${orgSlug}/support/customers/${customer.id}`} /> : null}
      </div>
    </div>
  );
}
