"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "../../components/basics";
import { EmptyState, NoAccess } from "../../components/states";
import { useMember } from "../../data/member";
import type { DemoCustomer } from "./demo/data";
import { supportDemo } from "./demo/store";
import { useSupportAccess } from "./SupportWorkspace";

/**
 * The role-limited customer (FIG-1178): who they are, who to talk to, what they have and what we already know about. Deal values, costs,
 * margins and payments are not here and the card says so, instead of leaving a gap (explained "no access", hard rule 7).
 */
export function CustomerSummary({ customer, href }: { customer: DemoCustomer; href?: string }) {
  return (
    <aside className="fb-sup__card" aria-label={`Customer ${customer.name}`}>
      <h2 className="fb-sup__h2">{href ? <Link href={href}>{customer.name}</Link> : customer.name}</h2>
      <div className="fb-sup__meta">
        {customer.industry} · <Badge tone="neutral">{customer.lifecycle}</Badge>
      </div>
      <dl className="fb-sup__dl">
        <dt>Phone</dt>
        <dd>{customer.phone}</dd>
        <dt>Email</dt>
        <dd>{customer.email}</dd>
        <dt>Location</dt>
        <dd>{customer.location}</dd>
      </dl>
      <h3 className="fb-sup__h3">Contacts</h3>
      {customer.contacts.map((c) => (
        <div key={c.email} className="fb-sup__meta">
          <strong>{c.name}</strong>, {c.title} · {c.email}
        </div>
      ))}
      <h3 className="fb-sup__h3">Services</h3>
      {customer.services.map((s) => (
        <div key={s.label} className="fb-sup__meta">
          {s.label} · <strong>{s.status}</strong> · since {s.since}
        </div>
      ))}
      {customer.knownIssues.length ? (
        <>
          <h3 className="fb-sup__h3">Known issues</h3>
          {customer.knownIssues.map((i) => (
            <div key={i} className="fb-sup__meta">
              {i}
            </div>
          ))}
        </>
      ) : null}
      <div className="fb-sup__locked">
        <Lock size={14} aria-hidden="true" /> Deal values, costs and payments aren’t shown to Customer Support. Ask Management or Finance if a ticket needs them.
      </div>
    </aside>
  );
}

export function CustomerView({ customerId }: { customerId: string }) {
  const allowed = useSupportAccess();
  const { orgSlug, roleName } = useMember();
  if (!allowed) return <NoAccess area="Support" denial={{ yourRole: roleName, ownerRoles: ["Customer Support", "Management"], whoToAsk: ["Management"] }} />;
  const customer = supportDemo.customer(customerId);
  return (
    <div className="fb-sup" data-screen-label="Support customer view">
      <Link className="fb-sup__back" href={`/o/${orgSlug}/support`}>
        <ArrowLeft size={15} aria-hidden="true" /> Support
      </Link>
      
      {customer ? <CustomerSummary customer={customer} /> : <EmptyState title="Customer not found" body="It may not be one you can see." />}
    </div>
  );
}
