"use client";

import { ErrorState, LoadingState, MaskedValue } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { contactName, dialLinks, type ContactDetail } from "../contacts/data";
import { useRefData } from "../deals/data";
import { dealTitle, dealValue, isMasked, kes, type DealDetail } from "../deals/model";
import { contactOf, leadName, useReference, type LeadDetail } from "../leads/data";
import { Icon } from "../leads/icons";
import { ago, dueLabel, initialsOf } from "./data";
import { useMobile } from "./MobileFrame";
import { PhotoAttach } from "./capture/PhotoAttach";

export type RecordType = "lead" | "contact" | "company" | "deal";

interface Activity {
  id: string;
  type: string;
  subject?: string | null;
  description?: string | null;
  occurredAt: string;
}

const ACT_ICON: Record<string, string> = { CALL: "phone", WHATSAPP: "whatsapp", EMAIL: "mail", MEETING: "calendar", NOTE: "message", TASK: "tasks" };
const ACT_LABEL: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp chat", EMAIL: "Email", MEETING: "Meeting", NOTE: "Note", TASK: "Task" };

interface Shown {
  name: string;
  sub: string;
  badge?: string;
  facts: { k: string; v: React.ReactNode }[];
  phone: string | null;
  target: { contactId?: string; leadId?: string; companyId?: string; dealId?: string; name: string };
  /** Who a reach (call, WhatsApp) is with; the first name for the prompt. */
  who: string;
}

/**
 * One record on the phone (M2): who it is, Call and WhatsApp (each asks "How did it go?" when you come back), Add a note, the facts and the
 * latest timeline. Reads the same endpoints as the desktop pages, so masking and permissions are the server's: a deal's value shows "hidden"
 * for a role that may not see it, and Call appears only for people who may log activity.
 */
export function RecordScreen({ type, id }: { type: RecordType; id: string }) {
  const { orgSlug, can } = useMember();
  const { reach, openNote } = useMobile();
  const ref = useReference();
  const refData = useRefData();
  const lead = useApiQuery("getLeadsByLeadId", { params: { orgSlug, leadId: id } }, { enabled: type === "lead", retry: false });
  const contact = useApiQuery("getContactsByContactId", { params: { orgSlug, contactId: id } }, { enabled: type === "contact", retry: false });
  const company = useApiQuery("getCompaniesByCompanyId", { params: { orgSlug, companyId: id } }, { enabled: type === "company", retry: false });
  const companyPeople = useApiQuery("getContacts", { params: { orgSlug }, query: { companyId: id, pageSize: "1" } as never }, { enabled: type === "company" && can("contacts.view") });
  const deal = useApiQuery("getDeal", { params: { orgSlug, dealId: id } }, { enabled: type === "deal", retry: false });
  const activityKey = type === "lead" ? { leadId: id } : type === "contact" ? { contactId: id } : type === "company" ? { companyId: id } : { dealId: id };
  const acts = useApiQuery("getActivities", { params: { orgSlug }, query: { ...activityKey, pageSize: "6" } as never }, { enabled: can("activities.view") });

  const q = { lead, contact, company, deal }[type];
  if (q.isPending) return <LoadingState label="Loading record" lines={5} />;
  if (q.isError) return <ErrorState error={q.error} area="This record" onRetry={() => void q.refetch()} />;

  let shown: Shown;
  if (type === "lead") {
    const l = lead.data as unknown as LeadDetail & { temperature: string; nextFollowUpAt: string | null; ownerMembershipId: string | null; serviceInterestId: string | null; leadStatus: { name: string }; leadSource?: { name: string } | null };
    const c = contactOf(l);
    const name = leadName(l);
    const due = dueLabel(l.nextFollowUpAt);
    shown = {
      name,
      sub: [ref.service(l.serviceInterestId)?.name, l.leadSource?.name].filter(Boolean).join(" · "),
      badge: `${l.leadStatus.name} · ${l.temperature}`,
      facts: [
        { k: "Contact", v: c ? contactName(c) : "—" },
        { k: "Phone", v: c?.phone ?? "—" },
        { k: "Next follow-up", v: l.nextFollowUpAt ? due.text : "None" },
        { k: "Owner", v: ref.memberName(l.ownerMembershipId) ?? "Unassigned" },
      ],
      phone: c?.phone ?? null,
      target: c ? { contactId: c.id, name: c.firstName } : { leadId: id, name },
      who: c?.firstName ?? name,
    };
  } else if (type === "contact") {
    const c = contact.data as unknown as ContactDetail & { company?: { name: string } | null };
    const name = contactName(c);
    shown = {
      name,
      sub: [c.jobTitle, c.company?.name].filter(Boolean).join(" · "),
      facts: [
        { k: "Phone", v: c.phone ?? "—" },
        { k: "Email", v: c.email ?? "—" },
        { k: "Company", v: c.company?.name ?? "—" },
      ],
      phone: c.phone ?? null,
      target: { contactId: id, name: c.firstName },
      who: c.firstName,
    };
  } else if (type === "company") {
    const c = company.data as unknown as { name: string; industry?: string | null; location?: string | null; phone?: string | null; email?: string | null };
    const person = ((companyPeople.data?.items ?? []) as unknown as { id: string; firstName: string; lastName?: string | null; phone?: string | null }[])[0];
    const phone = person?.phone ?? c.phone ?? null;
    shown = {
      name: c.name,
      sub: [c.industry, c.location].filter(Boolean).join(" · "),
      facts: [
        { k: "Main contact", v: person ? contactName(person) : "—" },
        { k: "Phone", v: phone ?? "—" },
        { k: "Email", v: c.email ?? "—" },
      ],
      phone,
      target: person?.phone ? { contactId: person.id, name: person.firstName } : { companyId: id, name: c.name },
      who: person?.firstName ?? c.name,
    };
  } else {
    const d = deal.data as unknown as DealDetail & { company?: { name: string } | null; expectedCloseDate?: string | null; pipelineStageId: string; currency: string; valueMasked?: boolean; value: string };
    const stage = refData.data?.stages.find((s) => s.id === d.pipelineStageId)?.name;
    const value = dealValue(d as never);
    shown = {
      name: d.company?.name ?? "Deal",
      sub: dealTitle(d as never),
      badge: stage,
      facts: [
        { k: "Value", v: isMasked(d as never) ? <MaskedValue /> : value === null ? "No value yet" : kes(value, d.currency) },
        { k: "Expected close", v: d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—" },
        { k: "Stage", v: stage ?? "—" },
      ],
      phone: null,
      target: { dealId: id, name: d.company?.name ?? "this deal" },
      who: d.company?.name ?? "this deal",
    };
  }

  const links = can("activities.create") ? dialLinks(shown.phone) : null;
  const timeline = ((acts.data?.items ?? []) as unknown as Activity[]).slice(0, 6);

  return (
    <div className="fb-m-page" data-screen-label="Mobile · Record">
      <div className="fb-m-rec-head">
        <span className="fb-m-avatar fb-m-avatar--big" aria-hidden="true">
          {initialsOf(shown.name)}
        </span>
        <h1>{shown.name}</h1>
        {shown.sub ? <div className="fb-m-muted">{shown.sub}</div> : null}
        {shown.badge ? <span className="fb-m-pill">{shown.badge}</span> : null}
      </div>

      {links ? (
        <div className="fb-m-reach">
          <a href={links.tel} className="fb-m-reach__btn fb-m-reach__btn--call" onClick={() => reach(shown.target, "CALL")}>
            <Icon name="phone" size={22} />
            Call
          </a>
          <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className="fb-m-reach__btn" onClick={() => reach(shown.target, "WHATSAPP")}>
            <Icon name="whatsapp" size={22} />
            WhatsApp
          </a>
        </div>
      ) : null}

      {can("activities.create") ? (
        <div className="fb-m-actions" style={{ gridTemplateColumns: "1fr" }}>
          <button type="button" className="fb-m-btn" onClick={() => openNote(shown.target)}>
            <Icon name="message" size={17} />
            Add a note
          </button>
        </div>
      ) : null}

      {can("activities.create") ? <PhotoAttach record={`${type}:${id}`} /> : null}

      <dl className="fb-m-facts">
        {shown.facts.map((f) => (
          <div key={f.k}>
            <dt>{f.k}</dt>
            <dd>{f.v}</dd>
          </div>
        ))}
      </dl>

      {can("activities.view") ? (
        <section>
          <h2 className="fb-m-h2">Recent</h2>
          {timeline.length === 0 ? (
            <div className="fb-m-empty">{acts.isPending ? "Loading…" : "Nothing logged yet."}</div>
          ) : (
            <ul className="fb-m-tl">
              {timeline.map((a) => (
                <li key={a.id}>
                  <span className="fb-m-tl__icon" aria-hidden="true">
                    <Icon name={ACT_ICON[a.type] ?? "circle"} size={14} />
                  </span>
                  <div>
                    <div className="fb-m-tl__text">{[a.subject && a.subject !== ACT_LABEL[a.type] ? a.subject : (ACT_LABEL[a.type] ?? a.type), a.description].filter(Boolean).join(": ")}</div>
                    <div className="fb-m-tl__when">{ago(a.occurredAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
