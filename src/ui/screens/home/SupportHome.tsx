"use client";

import Link from "next/link";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { DEMO_CUSTOMERS, type TicketStatus } from "../support/demo/data";
import { supportDemo, useTickets } from "../support/demo/store";
import { HIcon, KpiGrid, type KpiDef } from "./kit";
import { useOpenTaskCount } from "./roles";

const STATUSES: TicketStatus[] = ["Open", "Waiting on client", "Resolved"];
const companyName = (id: string) => DEMO_CUSTOMERS.find((c) => c.id === id)?.name ?? "Customer";

/**
 * The Customer Support home (the design's "Support" dashboard, FIG-1178): open tickets, waiting on the client and my tasks; and the open support tickets with their status changed in place. Nothing here carries a deal value or a payment.
 */
export function SupportHome() {
  const { orgSlug } = useMember();
  const tickets = useTickets();
  const toast = useToast();
  const myTasks = useOpenTaskCount();
  const base = `/o/${orgSlug}`;
  const open = tickets.filter((t) => t.status === "Open").length;
  const waiting = tickets.filter((t) => t.status !== "Open" && t.status !== "Resolved").length;
  const kpis: KpiDef[] = [
    { key: "open", label: "Open tickets", value: open, sub: "need a first response", icon: "help", tone: "blue", href: `${base}/support` },
    { key: "waiting", label: "Waiting on client", value: waiting, sub: "nothing to do yet", icon: "clock", tone: "orange" },
    { key: "tasks", label: "My tasks", value: myTasks ?? "…", sub: "assigned to you", icon: "tasks", tone: "green", href: `${base}/tasks` },
  ];
  const list = tickets.filter((t) => t.status !== "Resolved");
  return (
    <>
      <KpiGrid items={kpis} />
      <section className="fb-hp" aria-labelledby="sup-open">
        <div className="fb-hp__head">
          <h2 className="fb-hp__title" id="sup-open">
            Open support tickets
          </h2>
        </div>
        {list.map((t) => (
          <div key={t.id} className="fb-hrow fb-suphome__row">
            <span className="fb-tile fb-tone--blue" aria-hidden="true">
              <HIcon name="help" size={16} />
            </span>
            <div className="fb-suphome__main">
              <Link href={`${base}/support/${t.id}`} className="fb-suphome__title">
                {t.title}
              </Link>
              <Link href={`${base}/support/customers/${t.companyId}`} className="fb-suphome__company">
                {companyName(t.companyId)}
              </Link>
            </div>
            <select
              className="fb-suphome__status"
              aria-label="Ticket status"
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
          </div>
        ))}
      </section>
    </>
  );
}
