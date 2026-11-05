"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button } from "../../components/basics";
import { Textarea } from "../../components/forms";
import { EmptyState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, useAddTicketMessage, usePatchTicket, useSendSurvey, useSupportCustomer, useTicket, useWhen } from "./api";
import { CustomerSummary } from "./CustomerView";
import { SupportQueryState } from "./SupportState";
import { useSupportAccess } from "./SupportWorkspace";

/** One ticket (FIG-1178): the conversation, an internal-note switch (the customer never sees internal notes), the status, and the role-limited customer beside it. */
export function TicketDetail({ ticketId }: { ticketId: string }) {
  const allowed = useSupportAccess();
  const { orgSlug, roleName } = useMember();
  if (!allowed) return <NoAccess area="Support" denial={{ yourRole: roleName, ownerRoles: ["Customer Support", "Management"], whoToAsk: ["Management"] }} />;
  return <TicketBody ticketId={ticketId} orgSlug={orgSlug} />;
}

function TicketBody({ ticketId, orgSlug }: { ticketId: string; orgSlug: string }) {
  const toast = useToast();
  const when = useWhen();
  const q = useTicket(ticketId);
  const ticket = q.data;
  const customerQ = useSupportCustomer(ticket?.company.id);
  const patch = usePatchTicket();
  const add = useAddTicketMessage();
  const survey = useSendSurvey();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const fail = (e: unknown) => toast.show({ tone: "danger", message: describeError(e).body });

  const notFound = (q.error as { status?: number } | null)?.status === 404;
  if (notFound) return <EmptyState title="Ticket not found" body="It may have been removed, or the link is wrong." action={<Link href={`/o/${orgSlug}/support`}>Back to Support</Link>} />;

  function send() {
    if (!text.trim()) {
      setError("Write a message first");
      return;
    }
    setError(undefined);
    add.mutate(
      { params: { orgSlug, ticketId }, body: { kind: internal ? "INTERNAL" : "STAFF", body: text.trim() } },
      {
        onSuccess: () => {
          setText("");
          toast.show({ message: internal ? "Internal note added. The customer cannot see it." : "Reply recorded on the ticket.", tone: "success" });
        },
        onError: fail,
      },
    );
  }

  return (
    <div className="fb-sup" data-screen-label="Support ticket">
      <Link className="fb-sup__back" href={`/o/${orgSlug}/support`}>
        <ArrowLeft size={15} aria-hidden="true" /> Support
      </Link>
      <SupportQueryState query={q} area="The ticket">
        {ticket ? (
          <>
            <div className="fb-sup__head">
              <div>
                <h1 className="fb-sup__title fb-sup__title--sm">{ticket.title}</h1>
                <p className="fb-sup__sub">
                  #{ticket.number} · Opened {when(ticket.createdAt)} · {PRIORITY_LABEL[ticket.priority] ?? ticket.priority} priority · owner{" "}
                  {ticket.owner?.name ?? "unassigned"}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {ticket.status === "RESOLVED" ? (
                  <Button
                    size="sm"
                    disabled={survey.isPending}
                    onClick={() =>
                      survey.mutate(
                        { params: { orgSlug }, body: { ticketId } },
                        { onSuccess: () => toast.show({ message: "Satisfaction survey sent to the customer’s contact.", tone: "success" }), onError: fail },
                      )
                    }
                  >
                    Send survey
                  </Button>
                ) : null}
                <label className="fb-sup__status">
                  <span className="fb-sr-only">Status</span>
                  <select
                    className="fb-input"
                    value={ticket.status}
                    onChange={(e) =>
                      patch.mutate(
                        { params: { orgSlug, ticketId }, body: { status: e.target.value } },
                        { onSuccess: () => toast.show({ message: `Ticket marked ${STATUS_LABEL[e.target.value]}` }), onError: fail },
                      )
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="fb-sup__split">
              <section className="fb-sup__card" aria-label="Conversation">
                <h2 className="fb-sup__h2">Conversation</h2>
                {ticket.description ? <p>{ticket.description}</p> : null}
                {ticket.messages.map((m) => (
                  <div key={m.id} className="fb-sup__msg" data-internal={m.kind === "INTERNAL" || undefined}>
                    <div className="fb-sup__msghead">
                      <strong>{m.kind === "CUSTOMER" ? `${m.author} (customer)` : m.author}</strong> <span>{when(m.at)}</span>{" "}
                      {m.kind === "INTERNAL" ? <Badge tone="warning">Internal note</Badge> : null}
                    </div>
                    <p>{m.body}</p>
                  </div>
                ))}
                <Textarea label="Reply" rows={3} value={text} error={error} onChange={(e) => setText(e.target.value)} />
                <label className="fb-sup__check">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (the customer won’t see it)
                </label>
                <div>
                  <Button variant="primary" onClick={send} disabled={add.isPending}>
                    {internal ? "Add note" : "Send reply"}
                  </Button>
                </div>
              </section>
              {customerQ.data ? <CustomerSummary customer={customerQ.data} href={`/o/${orgSlug}/support/customers/${ticket.company.id}`} /> : null}
            </div>
          </>
        ) : null}
      </SupportQueryState>
    </div>
  );
}
