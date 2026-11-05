"use client";

import Link from "next/link";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { LoadingState } from "../../components/states";
import { STATUSES, STATUS_LABEL, usePatchTicket, useTicketList } from "../support/api";
import { HIcon, KpiGrid, type KpiDef } from "./kit";
import { useOpenTaskCount } from "./roles";

/**
 * The Customer Support home (the design's "Support" dashboard, FIG-1178): open tickets, waiting on the client and my tasks; and the open support
 * tickets with their status changed in place, read from the ticket route (FIG-1155). Nothing here carries a deal value or a payment.
 */
export function SupportHome() {
  const { orgSlug } = useMember();
  const q = useTicketList();
  const patch = usePatchTicket();
  const toast = useToast();
  const myTasks = useOpenTaskCount();
  const base = `/o/${orgSlug}`;
  const tickets = q.data?.items ?? [];
  const open = tickets.filter((t) => t.status === "OPEN").length;
  const waiting = tickets.filter((t) => t.status === "WAITING_ON_CLIENT").length;
  const kpis: KpiDef[] = [
    { key: "open", label: "Open tickets", value: q.isPending ? "…" : open, sub: "need a first response", icon: "help", tone: "blue", href: `${base}/support` },
    { key: "waiting", label: "Waiting on client", value: q.isPending ? "…" : waiting, sub: "nothing to do yet", icon: "clock", tone: "orange" },
    { key: "tasks", label: "My tasks", value: myTasks ?? "…", sub: "assigned to you", icon: "tasks", tone: "green", href: `${base}/tasks` },
  ];
  const list = tickets.filter((t) => t.status !== "RESOLVED");
  return (
    <>
      <KpiGrid items={kpis} />
      <section className="fb-hp" aria-labelledby="sup-open">
        <div className="fb-hp__head">
          <h2 className="fb-hp__title" id="sup-open">
            Open support tickets
          </h2>
        </div>
        {q.isPending ? <LoadingState label="Loading tickets" /> : null}
        {q.isError ? <QueryFailure error={q.error} area="Support tickets" onRetry={() => void q.refetch()} /> : null}
        {list.map((t) => (
          <div key={t.id} className="fb-hrow fb-suphome__row">
            <span className="fb-tile fb-tone--blue" aria-hidden="true">
              <HIcon name="help" size={16} />
            </span>
            <div className="fb-suphome__main">
              <Link href={`${base}/support/${t.id}`} className="fb-suphome__title">
                {t.title}
              </Link>
              <Link href={`${base}/support/customers/${t.company.id}`} className="fb-suphome__company">
                {t.company.name}
              </Link>
            </div>
            <select
              className="fb-suphome__status"
              aria-label="Ticket status"
              value={t.status}
              onChange={(e) =>
                patch.mutate(
                  { params: { orgSlug, ticketId: t.id }, body: { status: e.target.value } },
                  {
                    onSuccess: () => toast.show({ message: `Ticket marked ${STATUS_LABEL[e.target.value]}` }),
                    onError: (err) => toast.show({ tone: "danger", message: describeError(err).body }),
                  },
                )
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>
    </>
  );
}
