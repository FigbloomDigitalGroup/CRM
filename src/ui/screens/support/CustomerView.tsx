"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "../../components/basics";
import { EmptyState, NoAccess } from "../../components/states";
import { useMember } from "../../data/member";
import { useSupportCustomer, type SupportCustomer } from "./api";
import { SupportQueryState } from "./SupportState";
import { useSupportAccess } from "./SupportWorkspace";

/**
 * The role-limited customer (FIG-1178): who they are, who to talk to, what they have. Deal values, costs, margins and payments are not here and the
 * card says so, instead of leaving a gap (explained "no access", hard rule 7). The API never sends them.
 */
export function CustomerSummary({ customer, href }: { customer: SupportCustomer; href?: string }) {
  const c = customer.company;
  return (
    <aside className="fb-sup__card" aria-label={`Customer ${c.name}`}>
      <h2 className="fb-sup__h2">{href ? <Link href={href}>{c.name}</Link> : c.name}</h2>
      <div className="fb-sup__meta">
        {c.industry ?? "Industry not set"}
        {c.lifecycle ? (
          <>
            {" "}
            · <Badge tone="neutral">{c.lifecycle}</Badge>
          </>
        ) : null}
      </div>
      <dl className="fb-sup__dl">
        <dt>Phone</dt>
        <dd>{c.phone ?? "–"}</dd>
        <dt>Email</dt>
        <dd>{c.email ?? "–"}</dd>
        <dt>Location</dt>
        <dd>{c.location ?? "–"}</dd>
      </dl>
      <h3 className="fb-sup__h3">Contacts</h3>
      {customer.contacts.length === 0 ? <div className="fb-sup__meta">No contacts yet.</div> : null}
      {customer.contacts.map((p) => (
        <div key={p.id} className="fb-sup__meta">
          <strong>{p.name}</strong>
          {p.jobTitle ? `, ${p.jobTitle}` : ""}
          {p.email ? ` · ${p.email}` : ""}
        </div>
      ))}
      <h3 className="fb-sup__h3">Services</h3>
      {customer.services.length === 0 ? <div className="fb-sup__meta">No services yet.</div> : null}
      {customer.services.map((s) => (
        <div key={s.id} className="fb-sup__meta">
          {s.name} · <strong>{s.status}</strong>
          {s.since ? ` · since ${s.since}` : ""}
        </div>
      ))}
      <div className="fb-sup__locked">
        <Lock size={14} aria-hidden="true" /> Deal values, costs and payments aren’t shown to Customer Support. Ask Management or Finance if a ticket needs them.
      </div>
    </aside>
  );
}

export function CustomerView({ customerId }: { customerId: string }) {
  const allowed = useSupportAccess();
  const { orgSlug, roleName } = useMember();
  const q = useSupportCustomer(allowed ? customerId : undefined);
  if (!allowed) return <NoAccess area="Support" denial={{ yourRole: roleName, ownerRoles: ["Customer Support", "Management"], whoToAsk: ["Management"] }} />;
  const notFound = (q.error as { status?: number } | null)?.status === 404;
  return (
    <div className="fb-sup" data-screen-label="Support customer view">
      <Link className="fb-sup__back" href={`/o/${orgSlug}/support`}>
        <ArrowLeft size={15} aria-hidden="true" /> Support
      </Link>
      {notFound ? (
        <EmptyState title="Customer not found" body="It may not be one you can see." />
      ) : (
        <SupportQueryState query={q} area="The customer">
          {q.data ? <CustomerSummary customer={q.data} /> : null}
        </SupportQueryState>
      )}
    </div>
  );
}
