"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { describeError } from "../../errors";
import { ErrorState, LoadingState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery, useUndoable } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { ownerLabel, useFormatters, useReference } from "../leads/data";
import { DUE_COLOUR } from "../leads/format";
import { Icon } from "../leads/icons";
import { SideDrawer } from "../leads/overlay";
import { MergeDialog } from "../customers/merge/MergeDialog";
import { RecordExtras } from "../extras/RecordExtras";
import { ContactDrawer } from "./ContactDrawer";
import { contactName, initials, ownerName, useContactCaps, useRefreshContacts, type ContactDetail } from "./data";
import { ReachButtons, useCallLogPrompt } from "./QuickLogPrompt";

interface ActivityItem {
  id: string;
  type: string;
  subject?: string | null;
  description?: string | null;
  occurredAt: string;
  outcome?: string | null;
  authorMembershipId?: string | null;
}
interface CommItem {
  id: string;
  channel: string;
  direction: string;
  subject?: string | null;
  summary: string;
  occurredAt: string;
  activityId?: string | null;
  authorMembershipId?: string | null;
  needsLinking?: boolean;
}
interface TaskItem {
  id: string;
  title: string;
  dueAt?: string | null;
  status: string;
  assigneeMembershipId?: string | null;
}

const TYPE_ICON: Record<string, string> = { CALL: "phone", WHATSAPP: "whatsapp", EMAIL: "mail", MEETING: "users", NOTE: "note", OTHER: "message" };
const TYPE_LABEL: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", EMAIL: "Email", MEETING: "Meeting", NOTE: "Note", OTHER: "Message" };
const CHANNEL_TYPE: Record<string, string> = { PHONE: "CALL", WHATSAPP: "WHATSAPP", EMAIL: "EMAIL", MEETING: "MEETING", SMS: "OTHER", SOCIAL: "OTHER", OTHER: "OTHER" };
/** The design's "Recent conversations" lists calls, WhatsApp, email and meetings (not notes or system entries). */
const CONVERSATION_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING"];
const SHOWN = 8;

type TimelineRow = { id: string; icon: string; text: string; by: string; when: string; at: number; outcome?: string };

function TaskDrawer({ contactId, about, onClose }: { contactId: string; about: string; onClose: () => void }) {
  const { orgSlug, membershipId } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.call("postTasks", {
        params: { orgSlug },
        idempotencyKey: newIdempotencyKey(),
        body: { title: title.trim(), ...(due ? { dueAt: new Date(`${due}T10:00:00`).toISOString() } : {}), priority: "MEDIUM", contactId, assigneeMembershipId: membershipId },
      });
      toast.show({ message: "Task created" });
      await refresh();
      onClose();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SideDrawer
      title="New task"
      subtitle={`About ${about}.`}
      onClose={onClose}
      label="New task"
      footer={
        <>
          <button type="button" className="fb-ld-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={!title.trim() || busy} onClick={save}>
            Create task
          </button>
        </>
      }
    >
      <label className="fb-ld-field">
        <span>
          What needs doing? <span className="fb-ld-req" aria-hidden="true">*</span>
        </span>
        <input className="fb-ld-input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send the revised quote" />
      </label>
      <label className="fb-ld-field">
        <span>Due</span>
        <input className="fb-ld-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </SideDrawer>
  );
}

/**
 * The contact page (C3, FIG-1096): who they are, their company, call and WhatsApp (each followed by the log prompt), recent conversations,
 * open tasks, and the shared record extras. Contacts are shared across the organisation; archived ones are read-only until restored.
 */
export function ContactDetailScreen({ contactId }: { contactId: string }) {
  const { orgSlug, membershipId, userName, can } = useMember();
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const undoable = useUndoable();
  const ref = useReference();
  const fmt = useFormatters();
  const caps = useContactCaps();
  const refresh = useRefreshContacts();
  const prompt = useCallLogPrompt();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [survivor, setSurvivor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState(false);

  const contactQ = useApiQuery("getContactsByContactId", { params: { orgSlug, contactId } });
  const activitiesQ = useApiQuery("getActivities", { params: { orgSlug }, query: { contactId, pageSize: "30" } as never }, { enabled: can("activities.view") });
  const commsQ = useApiQuery("getCommunications", { params: { orgSlug }, query: { contactId } as never }, { enabled: can("communications.view") });
  const tasksQ = useApiQuery("getTasks", { params: { orgSlug }, query: { contactId, pageSize: "20" } as never }, { enabled: can("tasks.view.own") || can("tasks.view.all") });

  const who = (id: string | null | undefined): string => (id ? (id === membershipId ? userName : (ref.memberName(id) ?? "Team member")) : "Figbloom automation");

  const timeline = useMemo<TimelineRow[]>(() => {
    const acts = ((activitiesQ.data?.items ?? []) as unknown as ActivityItem[]).filter((a) => CONVERSATION_TYPES.includes(a.type)).map<TimelineRow>((a) => ({
      id: `a-${a.id}`,
      icon: TYPE_ICON[a.type] ?? "circle",
      text: [a.subject && a.subject !== TYPE_LABEL[a.type] ? a.subject : (TYPE_LABEL[a.type] ?? a.type), a.description].filter(Boolean).join(": "),
      by: who(a.authorMembershipId),
      when: fmt.when(a.occurredAt),
      at: new Date(a.occurredAt).getTime(),
      outcome: a.outcome ?? undefined,
    }));
    // A logged conversation is already an activity; only messages that are not (an inbound email, say) are added, so nothing shows twice.
    const comms = ((Array.isArray(commsQ.data) ? commsQ.data : []) as unknown as CommItem[])
      .filter((c) => !c.activityId && !c.needsLinking)
      .map<TimelineRow>((c) => {
        const type = CHANNEL_TYPE[c.channel] ?? "OTHER";
        return {
          id: `c-${c.id}`,
          icon: TYPE_ICON[type] ?? "message",
          text: [c.subject, c.summary].filter(Boolean).join(": ") || TYPE_LABEL[type]!,
          by: c.direction === "INBOUND" ? "Received" : who(c.authorMembershipId),
          when: fmt.when(c.occurredAt),
          at: new Date(c.occurredAt).getTime(),
        };
      });
    return [...acts, ...comms].sort((a, b) => b.at - a.at);
  }, [activitiesQ.data, commsQ.data, ref, fmt, membershipId, userName]);

  const tasks = ((tasksQ.data?.items ?? []) as unknown as TaskItem[]).filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");

  if (contactQ.isLoading) return <LoadingState label="Loading the contact" lines={6} />;
  if (contactQ.isError) {
    const d = describeError(contactQ.error);
    if (d.kind === "noAccess") return <NoAccess area="This contact" denial={d.denial} />;
    return <ErrorState error={contactQ.error} area="This contact" onRetry={() => contactQ.refetch()} />;
  }
  const contact = contactQ.data as ContactDetail | undefined;
  if (!contact) return null;

  const c = caps(contact);
  const name = contactName(contact);
  const first = contact.firstName;
  const company = contact.company ?? null;
  const owner = ownerName(contact);
  const social = Array.isArray(contact.socialProfiles) ? (contact.socialProfiles as string[]).join(", ") : typeof contact.socialProfiles === "string" ? contact.socialProfiles : "";
  const shown = all ? timeline : timeline.slice(0, SHOWN);

  async function reassign(ownerId: string) {
    try {
      await api.call("patchContactsByContactId", { params: { orgSlug, contactId }, body: { ownerMembershipId: ownerId } });
      toast.show({ message: `${name} reassigned to ${ref.memberName(ownerId) ?? "the new owner"}` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function archive() {
    try {
      await undoable({
        run: () => api.call("postContactsByContactIdArchive", { params: { orgSlug, contactId }, body: {}, idempotencyKey: newIdempotencyKey() }).then(refresh),
        undo: () => api.call("postContactsByContactIdRestore", { params: { orgSlug, contactId }, idempotencyKey: newIdempotencyKey() } as never).then(refresh),
        message: `${name} archived`,
      });
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function restore() {
    try {
      await api.call("postContactsByContactIdRestore", { params: { orgSlug, contactId }, idempotencyKey: newIdempotencyKey() } as never);
      toast.show({ message: `${name} restored` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }

  const facts: { k: string; v: React.ReactNode }[] = [
    { k: "PHONE", v: contact.phone || "—" },
    { k: "EMAIL", v: contact.email || "—" },
    { k: "DEPARTMENT", v: (contact.department as string | null) || "—" },
    { k: "SOCIAL PROFILE", v: social || "—" },
    {
      k: "OWNER",
      v: c.canReassign ? (
        <select className="fb-ld-owner-select" aria-label="Owner" value={contact.ownerMembershipId} onChange={(e) => e.target.value && reassign(e.target.value)}>
          {!ref.owners.some((o) => o.membershipId === contact.ownerMembershipId) ? <option value={contact.ownerMembershipId}>{owner}</option> : null}
          {ref.owners.map((o) => (
            <option key={o.membershipId} value={o.membershipId}>
              {ownerLabel(o, membershipId)}
            </option>
          ))}
        </select>
      ) : (
        owner
      ),
    },
    { k: "COMPANY", v: company ? company.name : "Standalone contact" },
  ];

  return (
    <div className="fb-ld fb-ct fb-ct-detail" data-screen-label="Contact detail">
      <Link href={`/o/${orgSlug}/contacts`} className="fb-ct-back">
        <Icon name="arrow-left" size={15} />
        Contacts
      </Link>

      {c.archived ? (
        <div role="status" className="fb-ld-banner fb-ld-banner--archived">
          <Icon name="archive" size={17} />
          <span>
            <strong>Archived.</strong> Everything on this contact is read-only until it’s restored.
          </span>
          {c.canRestore ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--sm" onClick={restore}>
              Restore
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="fb-ct-top">
        <span className="fb-ct-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div className="fb-ct-top__who">
          <h1 className="fb-ld-title">{name}</h1>
          <div className="fb-ct-top__line">
            {contact.jobTitle ? <>{contact.jobTitle as string}</> : null}
            {contact.jobTitle && company ? " at " : null}
            {company ? (
              <Link href={`/o/${orgSlug}/companies/${company.id}`} className="fb-ct-company">
                {company.name}
              </Link>
            ) : null}
            {!contact.jobTitle && !company ? <span className="fb-ld-muted">Standalone contact</span> : null}
          </div>
        </div>
        <div className="fb-ld-actions">
          {c.canEdit ? (
            <button type="button" className="fb-ld-btn" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={16} />
              Edit
            </button>
          ) : null}
          {c.canMerge ? (
            <button type="button" className="fb-ld-btn" onClick={() => setMerging(true)}>
              <Icon name="merge" size={16} />
              Merge
            </button>
          ) : null}
          {c.canArchive ? (
            <button type="button" className="fb-ld-btn" onClick={archive}>
              <Icon name="archive" size={16} />
              Archive
            </button>
          ) : null}
        </div>
      </div>

      <div className="fb-ct-reachrow">
        {c.canReach && !c.archived ? <ReachButtons variant="wide" name={name} firstName={first} phone={contact.phone} target={{ contactId, name: first }} begin={prompt.begin} /> : null}
        {contact.email ? (
          <a className="fb-ct-wide" href={`mailto:${contact.email}`}>
            <Icon name="mail" size={18} />
            Email
          </a>
        ) : null}
      </div>

      <section className="fb-ct-panel" aria-label="Details">
        <dl className="fb-ct-facts">
          {facts.map((f) => (
            <div key={f.k}>
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="fb-ct-grid">
        <div className="fb-ct-col">
          <section className="fb-ct-panel fb-ct-panel--flush" aria-label="Company">
            <div className="fb-ct-panel__head">
              <h2>Company</h2>
              {!company && c.canEdit ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--link" onClick={() => setEditing(true)}>
                  + Link a company
                </button>
              ) : null}
            </div>
            {company ? (
              <Link href={`/o/${orgSlug}/companies/${company.id}`} className="fb-ct-companycard">
                <span className="fb-ct-companycard__ini">{initials(company.name)}</span>
                <span className="fb-ct-companycard__body">
                  <span className="fb-ct-companycard__name">{company.name}</span>
                  <span className="fb-ct-companycard__sub">{[company.industry as string | null, company.location as string | null].filter(Boolean).join(" · ") || "Open the customer page"}</span>
                </span>
                <Icon name="arrow-right" size={15} />
              </Link>
            ) : (
              <div className="fb-ct-empty">A standalone contact: not linked to a company yet.</div>
            )}
          </section>

          <section className="fb-ct-panel fb-ct-panel--flush" aria-label="Recent conversations">
            <div className="fb-ct-panel__head">
              <h2>Recent conversations</h2>
            </div>
            <div className="fb-ct-tl">
              {activitiesQ.isLoading || commsQ.isLoading ? <div className="fb-ct-empty">Loading…</div> : null}
              {shown.map((a) => (
                <div key={a.id} className="fb-ct-tl__item">
                  <span className="fb-ct-tl__icon">
                    <Icon name={a.icon as never} size={15} />
                  </span>
                  <div>
                    <div className="fb-ct-tl__text">{a.text}</div>
                    <div className="fb-ct-tl__by">
                      {a.by} · {a.when}
                      {a.outcome ? <span className="fb-ct-tl__outcome">{a.outcome}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
              {!activitiesQ.isLoading && !commsQ.isLoading && timeline.length === 0 ? <div className="fb-ct-empty">No conversations logged yet. Call or WhatsApp and you’ll be asked to log it.</div> : null}
              {timeline.length > SHOWN ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--link fb-ct-more" onClick={() => setAll((v) => !v)}>
                  {all ? "Show fewer" : `Show all ${timeline.length}`}
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <div className="fb-ct-col">
          <section className="fb-ct-panel fb-ct-panel--flush" aria-label="Tasks">
            <div className="fb-ct-panel__head">
              <h2>Tasks</h2>
              {can("tasks.create") && !c.archived ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--link" onClick={() => setAdding(true)}>
                  + Add
                </button>
              ) : null}
            </div>
            {tasks.map((t) => {
              const ds = fmt.dueState(t.dueAt);
              return (
                <Link key={t.id} href={`/o/${orgSlug}/tasks`} className="fb-ct-task">
                  <span className="fb-ct-task__title">{t.title}</span>
                  <span className="fb-ct-task__due" style={{ color: DUE_COLOUR[ds] }}>
                    {t.dueAt ? fmt.dueLabel(t.dueAt) : "No date"}
                  </span>
                </Link>
              );
            })}
            {!tasksQ.isLoading && tasks.length === 0 ? <div className="fb-ct-empty">No open tasks for this contact.</div> : null}
          </section>
        </div>
      </div>

      <RecordExtras kind="contact" id={contactId} archived={c.archived} />

      {editing ? <ContactDrawer contactId={contactId} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
      {merging ? (
        <MergeDialog
          kind="contact"
          id={contactId}
          onClose={() => {
            setMerging(false);
            void refresh();
            // A merge that kept the other contact leaves this page archived: go to the one that survived.
            if (survivor && survivor !== contactId) router.push(`/o/${orgSlug}/contacts/${survivor}`);
            setSurvivor(null);
          }}
          onMerged={setSurvivor}
          onUndone={() => setSurvivor(null)}
        />
      ) : null}
      {adding ? <TaskDrawer contactId={contactId} about={name} onClose={() => setAdding(false)} /> : null}
      {prompt.element}
    </div>
  );
}
