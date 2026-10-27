"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "../../errors";
import { ErrorState, LoadingState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery, useUndoable } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { contactName, contactOf, leadName, ownerLabel, useFormatters, useLeadCaps, useReference, useRefreshLeads, type LeadDetail, type Qualification } from "./data";
import { ConvertDialog } from "./ConvertDialog";
import { LeadDrawer } from "./LeadDrawer";
import { LostDialog } from "./LostDialog";
import { NoteDrawer, TaskDrawer, type CommKind } from "./QuickDrawers";
import { DUE_COLOUR, statusTone, TEMPERATURES, TEMPERATURE_LABEL, tempTone, type Temperature } from "./format";
import { Icon } from "./icons";

interface ActivityItem {
  id: string;
  type: string;
  subject?: string | null;
  description?: string | null;
  occurredAt: string;
  outcome?: string | null;
  authorMembershipId?: string | null;
}
interface AuditItem {
  id: string;
  action: string;
  actorMembershipId?: string | null;
  createdAt: string;
  newValue?: unknown;
  previousValue?: unknown;
  metadata?: unknown;
}
interface TaskItem {
  id: string;
  title: string;
  dueAt?: string | null;
  status: string;
}
type TimelineRow = { id: string; icon: string; kind: "comm" | "sys" | "plain"; text: string; by: string; when: string; at: number; outcome?: string };

const COMM_ICON: Record<string, string> = { CALL: "phone", WHATSAPP: "whatsapp", EMAIL: "mail", MEETING: "users", NOTE: "note", OTHER: "message" };
const COMM_LABEL: Record<string, string> = { CALL: "Call", WHATSAPP: "WhatsApp", EMAIL: "Email", MEETING: "Meeting", NOTE: "Note", OTHER: "Message" };
const COMM_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING"];

const sentence = (s: string) => s.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * The lead page (L2, FIG-1084): the progress strip, the qualification questions for the lead's service, the next follow-up, the timeline,
 * tasks, owner and contact. A converted lead is locked, an archived lead is read-only, and a possible duplicate is only ever a warning.
 */
export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const { orgSlug, can, membershipId } = useMember();
  const api = useApi();
  const toast = useToast();
  const undoable = useUndoable();
  const ref = useReference();
  const fmt = useFormatters();
  const caps = useLeadCaps();
  const refresh = useRefreshLeads();

  const leadQ = useApiQuery("getLeadsByLeadId", { params: { orgSlug, leadId } });
  const qualQ = useApiQuery("getLeadsByLeadIdQualification", { params: { orgSlug, leadId } }, { enabled: leadQ.isSuccess });
  const lead = leadQ.data as (LeadDetail & { lostReason?: { name: string } | null; leadSource?: { id: string; key: string; name: string } | null; archiveReason?: string | null }) | undefined;
  const qual = qualQ.data as unknown as Qualification | undefined;
  const tasksQ = useApiQuery("getTasks", { params: { orgSlug }, query: { leadId } }, { enabled: leadQ.isSuccess && can("tasks.view.own") || can("tasks.view.all") });
  const activitiesQ = useApiQuery("getActivities", { params: { orgSlug }, query: { leadId, pageSize: "50" } as never }, { enabled: leadQ.isSuccess && can("activities.view") });
  const auditQ = useApiQuery("getAudit", { params: { orgSlug }, query: { entityType: "Lead", entityId: leadId } as never }, { enabled: leadQ.isSuccess && can("audit.view") });
  const scoreQ = useApiQuery("getLeadsByLeadIdScore", { params: { orgSlug, leadId } }, { enabled: leadQ.isSuccess });
  const dealsQ = useApiQuery("getDeals", { params: { orgSlug }, query: { companyId: lead?.companyId ?? undefined, pageSize: "10" } }, { enabled: Boolean(lead?.companyId) && (can("deals.view.all") || can("deals.view.own") || can("deals.view.won")) });

  const [edit, setEdit] = useState(false);
  const [convert, setConvert] = useState(false);
  const [lost, setLost] = useState(false);
  const [note, setNote] = useState<{ kind: CommKind } | null>(null);
  const [addTask, setAddTask] = useState(false);
  const [tl, setTl] = useState<"all" | "comms" | "audit">("all");
  const [stripError, setStripError] = useState<{ message: string; missing: { key: string; label: string; message: string }[] } | null>(null);

  const c = lead ? caps(lead as never) : null;
  const contact = lead ? contactOf(lead) : null;
  const name = lead ? leadName(lead) : "";

  // ---- qualification answers: saved as you type
  const questions = qual?.questions ?? [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const seeded = useRef<string>("");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Answers are written one at a time: two answers saved at once would each read the old set on the server and the later write would drop the earlier.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (!qual) return;
    const sig = `${qual.leadId}:${qual.questions.map((q) => q.key).join(",")}`;
    if (seeded.current === sig) return;
    seeded.current = sig;
    setValues(Object.fromEntries(qual.questions.map((q) => [q.key, q.answer ?? ""])));
  }, [qual]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  function answer(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      setSaveState("saving");
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          await api.call("patchLeadsByLeadIdQualification", { params: { orgSlug, leadId }, body: { answers: { [key]: value === "" ? null : value } } });
          setSaveState("saved");
          setStripError(null);
          void qualQ.refetch();
          void scoreQ.refetch();
        } catch {
          setSaveState("error");
        }
      });
    }, 600);
  }

  // ---- actions
  async function patch(body: Record<string, unknown>, okMessage?: string) {
    try {
      await api.call("patchLeadsByLeadId", { params: { orgSlug, leadId }, body: body as never });
      if (okMessage) toast.show({ message: okMessage });
      await refresh();
      return true;
    } catch (err) {
      const d = describeError(err);
      toast.show({ tone: "danger", message: d.body });
      return false;
    }
  }
  async function moveTo(key: string) {
    const target = ref.statusByKey(key);
    if (!target || !lead) return;
    setStripError(null);
    if (key === "QUALIFIED" && qual && !qual.progress.canQualify) {
      setStripError({ message: "This lead can’t be marked Qualified yet. A few answers are still needed:", missing: qual.progress.missing });
      return;
    }
    try {
      await api.call("patchLeadsByLeadId", { params: { orgSlug, leadId }, body: { leadStatusId: target.id } });
      toast.show({ message: `Status set to ${target.name}` });
      await refresh();
    } catch (err) {
      const d = describeError(err);
      setStripError({ message: d.body, missing: [] });
    }
  }
  function reschedule(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    void patch({ nextFollowUpAt: d.toISOString() }, `Follow-up moved to ${fmt.when(d)}`);
  }
  async function archive() {
    try {
      await undoable({
        run: () => api.call("postLeadsByLeadIdArchive", { params: { orgSlug, leadId }, body: {}, idempotencyKey: newIdempotencyKey() }).then(refresh),
        undo: () => api.call("postLeadsByLeadIdRestore", { params: { orgSlug, leadId }, idempotencyKey: newIdempotencyKey() }).then(refresh),
        message: `${name} archived`,
      });
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function restore() {
    try {
      await api.call("postLeadsByLeadIdRestore", { params: { orgSlug, leadId }, idempotencyKey: newIdempotencyKey() });
      toast.show({ message: `${name} restored` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function reassign(ownerId: string) {
    try {
      await api.call("postLeadsByLeadIdAssign", { params: { orgSlug, leadId }, body: { ownerMembershipId: ownerId }, idempotencyKey: newIdempotencyKey() });
      toast.show({ message: `${name} reassigned to ${ref.memberName(ownerId) ?? "the new owner"}` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function toggleTask(t: TaskItem) {
    const done = t.status === "COMPLETED";
    try {
      await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: t.id }, body: { status: done ? "PENDING" : "COMPLETED" } });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }

  // ---- derived
  const tasks = ((tasksQ.data?.items ?? []) as unknown as TaskItem[]).filter((t) => t.status !== "CANCELLED");
  const openTask = tasks.find((t) => t.status !== "COMPLETED");
  const deals = (dealsQ.data?.items ?? []) as unknown as { id: string; leadId?: string | null; outcome: string; ownerMembershipId: string; pipelineStage?: { name: string }; service?: { name: string } | null }[];
  const openDeal = deals.find((d) => d.outcome === "OPEN");
  const myDeal = deals.find((d) => d.leadId === leadId);

  const timeline = useMemo<TimelineRow[]>(() => {
    const acts = ((activitiesQ.data?.items ?? []) as unknown as ActivityItem[]).map<TimelineRow>((a) => ({
      id: a.id,
      icon: COMM_ICON[a.type] ?? "circle",
      kind: COMM_TYPES.includes(a.type) ? "comm" : "plain",
      text: [a.subject && a.subject !== COMM_LABEL[a.type] ? a.subject : COMM_LABEL[a.type] ?? a.type, a.description].filter(Boolean).join(": "),
      by: ref.memberName(a.authorMembershipId) ?? "Figbloom automation",
      when: fmt.when(a.occurredAt),
      at: new Date(a.occurredAt).getTime(),
      outcome: a.outcome ?? undefined,
    }));
    const audits = ((auditQ.data ?? []) as unknown as AuditItem[]).map<TimelineRow>((a) => ({
      id: `a-${a.id}`,
      icon: a.action.includes("assign") ? "user" : a.action.includes("status") || a.action.includes("updated") ? "swap" : "zap",
      kind: "sys",
      text: sentence(a.action),
      by: ref.memberName(a.actorMembershipId) ?? "Figbloom automation",
      when: fmt.when(a.createdAt),
      at: new Date(a.createdAt).getTime(),
    }));
    const rows = tl === "comms" ? acts.filter((r) => r.kind === "comm") : tl === "audit" ? audits : [...acts, ...audits];
    return rows.sort((a, b) => b.at - a.at);
  }, [activitiesQ.data, auditQ.data, tl, ref, fmt]);

  if (leadQ.isLoading) return <LoadingState label="Loading the lead" lines={6} />;
  if (leadQ.isError) {
    const d = describeError(leadQ.error);
    if (d.kind === "noAccess") return <NoAccess area="This lead" denial={d.denial} />;
    return <ErrorState error={leadQ.error} area="This lead" onRetry={() => leadQ.refetch()} />;
  }
  if (!lead || !c) return null;

  const status = lead.leadStatus;
  const [sbg, sfg] = statusTone(status.key);
  const [tbg, tfg] = tempTone(lead.temperature);
  const ro = !c.canEdit;
  const scopeClass = ro ? "fb-ld-scope--ro" : can("leads.view.all") ? "fb-ld-scope--org" : "fb-ld-scope--own";
  const scopeLabel = ro ? "Read-only" : can("leads.view.all") ? (c.isMine ? "Organisation · yours" : "Organisation") : "Own";
  const website = lead.leadSource?.key === "WEBSITE";
  const qd = (lead.qualificationData ?? {}) as { source?: string; utm?: Record<string, string> };
  const webSubmission = website && qd.source === "website_form";
  const service = ref.service(lead.serviceInterestId as string | null);
  const createdLine = `${service?.name ?? "No service chosen yet"} · ${lead.leadSource?.name ?? "Unknown source"} · created ${fmt.date(lead.createdAt)}`;
  const next = lead.nextFollowUpAt as string | null;
  const nextState = fmt.dueState(next);
  const stages = qual?.progress.stages ?? [];
  const offStrip = qual?.progress.offStrip ?? null;
  const dupText = openDeal && !c.converted ? `${lead.company?.name ?? "This company"} already has an open deal (${openDeal.service?.name ?? "deal"}${openDeal.pipelineStage ? `, ${openDeal.pipelineStage.name}` : ""}) owned by ${ref.memberName(openDeal.ownerMembershipId) ?? "a colleague"}. Worth a word before you call.` : null;
  const canAudit = can("audit.view");

  return (
    <div className="fb-ld" data-screen-label="Lead detail">
      <Link href={`/o/${orgSlug}/leads`} className="fb-ld-back">
        <Icon name="arrow-left" size={15} />
        Leads
      </Link>

      {c.archived ? (
        <div role="status" className="fb-ld-banner fb-ld-banner--archived">
          <Icon name="archive" size={17} />
          <span>
            <strong>Archived.</strong> This lead is read-only until it’s restored.
          </span>
          {c.canRestore ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary" style={{ height: 34, borderRadius: 8 }} onClick={restore}>
              Restore
            </button>
          ) : null}
        </div>
      ) : null}
      {dupText ? (
        <div role="status" className="fb-ld-banner fb-ld-banner--dup">
          <Icon name="alert" size={17} />
          <span>
            <strong>Heads-up:</strong> {dupText}
          </span>
          {lead.companyId ? (
            <Link href={`/o/${orgSlug}/companies/${lead.companyId}`} className="fb-ld-banner__link">
              Open customer
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="fb-ld-head">
        <div>
          <div className="fb-ld-namerow">
            <h1 className="fb-ld-title">{name}</h1>
            <span className="fb-ld-status" style={{ background: sbg, color: sfg }}>
              {status.name}
            </span>
            <span className="fb-ld-temp" style={{ background: tbg, color: tfg }}>
              {lead.temperature}
            </span>
            {website ? (
              <span className="fb-ld-webpill">
                <Icon name="globe" size={12} />
                Website lead
              </span>
            ) : null}
          </div>
          <div className="fb-ld-meta">
            <span className={`fb-ld-scope ${scopeClass}`}>
              <span className="fb-ld-scope__dot" />
              {scopeLabel}
            </span>
            <span className="fb-ld-hint">{createdLine}</span>
          </div>
        </div>
        {c.canEdit ? (
          <div className="fb-ld-actions">
            {can("activities.create") ? (
              <button type="button" className="fb-ld-btn" onClick={() => setNote({ kind: "call" })}>
                <Icon name="phone" size={16} />
                Log a call
              </button>
            ) : null}
            <button type="button" className="fb-ld-btn" onClick={() => setEdit(true)}>
              <Icon name="pencil" size={15} />
              Edit
            </button>
            {!c.converted && status.key !== "LOST" ? (
              <button type="button" className="fb-ld-btn fb-ld-btn--danger" onClick={() => setLost(true)}>
                Mark lost
              </button>
            ) : null}
            <button type="button" className="fb-ld-btn fb-ld-btn--square" aria-label="Archive" title={c.canArchive ? "Archive" : "Your role cannot archive this lead"} disabled={!c.canArchive} onClick={archive}>
              <Icon name="archive" size={16} />
            </button>
            {c.converted ? (
              myDeal ? (
                <Link className="fb-ld-btn fb-ld-btn--primary" href={`/o/${orgSlug}/deals/${myDeal.id}`}>
                  <Icon name="arrow-circle" size={16} />
                  View deal
                </Link>
              ) : null
            ) : (
              <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={!c.canConvert} title={c.canConvert ? undefined : "Your role cannot convert leads"} onClick={() => setConvert(true)}>
                <Icon name="arrow-circle" size={16} />
                Convert to deal
              </button>
            )}
          </div>
        ) : null}
      </div>

      <section aria-label="Lead progress" className="fb-ld-panel fb-ld-panel--tight">
        <div className="fb-ld-steps">
          {offStrip ? (
            <>
              <span className="fb-ld-step fb-ld-step--off" role="status" style={{ flex: "none" }}>
                <span className="fb-ld-step__dot">!</span>
                {offStrip.name}
              </span>
              <span className="fb-ld-steps__arrow">
                <Icon name="chevron-right" size={14} />
              </span>
            </>
          ) : null}
          {stages.map((s, i) => {
            const state = offStrip ? "todo" : s.state;
            return (
              <span key={s.key} style={{ display: "contents" }}>
                <button
                  type="button"
                  className="fb-ld-step"
                  data-state={state}
                  aria-current={state === "current" ? "step" : undefined}
                  disabled={ro || c.converted || s.key === "CONVERTED"}
                  onClick={() => void moveTo(s.key)}
                  title={c.converted ? "This lead has been converted to a deal, so its status can no longer change" : s.key === "CONVERTED" ? "A lead becomes Converted by converting it to a deal" : undefined}
                >
                  <span className="fb-ld-step__dot">{state === "done" ? "✓" : i + 1}</span>
                  {s.name}
                </button>
                {i < stages.length - 1 ? (
                  <span className="fb-ld-steps__arrow">
                    <Icon name="chevron-right" size={14} />
                  </span>
                ) : null}
              </span>
            );
          })}
          <span className="fb-ld-steps__arrow">
            <Icon name="chevron-right" size={14} />
          </span>
          {can("deals.view.all") || can("deals.view.own") || can("deals.view.won") ? (
            <Link href={`/o/${orgSlug}/deals`} className="fb-ld-step--deal">
              <Icon name="briefcase" size={14} />
              Deal board
            </Link>
          ) : null}
        </div>
        {stripError ? (
          <div role="alert" className="fb-ld-missing">
            {stripError.message}
            {stripError.missing.length ? (
              <ul>
                {stripError.missing.map((m) => (
                  <li key={m.key}>
                    <strong>{m.label}</strong> {m.message ? `· ${m.message}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="fb-ld-steps__note">These are lead statuses. Converting creates a deal in Solution Presented; from there the work continues on the Deals board.</div>
      </section>

      <div className="fb-ld-grid">
        <div className="fb-ld-main">
          <section className="fb-ld-next-card" aria-label="Next follow-up">
            <span className="fb-ld-next-card__icon">
              <Icon name="arrow-circle" size={20} />
            </span>
            <div className="fb-ld-next-card__body">
              <div className="fb-ld-eyebrow">NEXT FOLLOW-UP</div>
              <div className="fb-ld-next-card__when" style={{ color: nextState === "overdue" ? "var(--red)" : "var(--text)" }}>
                {next ? fmt.dueLabel(next) : "No follow-up set"}
              </div>
              <div className="fb-ld-next-card__task">{openTask ? openTask.title : "Pick a time so this lead doesn’t go cold."}</div>
            </div>
            {c.canEdit ? (
              <div className="fb-ld-pills">
                {[
                  ["Tomorrow", 1],
                  ["In 3 days", 3],
                  ["Next week", 7],
                ].map(([l, d]) => (
                  <button key={l} type="button" className="fb-ld-pill" onClick={() => reschedule(d as number)}>
                    {l}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {webSubmission ? (
            <section className="fb-ld-panel" data-screen-label="Website submission">
              <div className="fb-ld-website__head">
                <span className="fb-ld-website__icon">
                  <Icon name="globe" size={16} />
                </span>
                <h2>What they sent through the website</h2>
              </div>
              {lead.notes ? <p className="fb-ld-website__msg">“{lead.notes as string}”</p> : null}
              <dl className="fb-ld-dl">
                <div>
                  <dt className="fb-ld-eyebrow">CAMPAIGN</dt>
                  <dd style={{ fontFamily: "var(--fb-mono, monospace)", fontSize: 12, color: "var(--text-2)", fontWeight: 400 }}>
                    {qd.utm && Object.keys(qd.utm).length ? Object.entries(qd.utm).map(([k, v]) => `${k}=${v}`).join(" · ") : "Direct"}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          <section className="fb-ld-panel" aria-labelledby="fb-ld-qual-h">
            <div className="fb-ld-panel__head">
              <h2 id="fb-ld-qual-h">Qualification · {service?.name ?? "General"}</h2>
              <span className="fb-ld-panel__note">
                Adapts to the service · saved as you type
                {saveState === "saving" ? " · saving…" : saveState === "saved" ? " · saved" : saveState === "error" ? " · couldn’t save" : ""}
              </span>
            </div>
            {qualQ.isLoading ? <div style={{ marginTop: 14 }} className="fb-ld-skel" /> : null}
            {qual && questions.length === 0 ? <p className="fb-ld-hint" style={{ margin: "14px 0 0" }}>No qualification questions for this service yet. Management can add them in Settings.</p> : null}
            <div className="fb-ld-qual">
              {questions.map((q) => {
                const id = `fb-ld-q-${q.key}`;
                const v = values[q.key] ?? "";
                const missing = qual?.progress.missing.some((m) => m.key === q.key) && q.requiredOnQualify;
                const label = (
                  <span>
                    {q.label}
                    {q.requiredOnQualify ? <span className="fb-ld-req" title="Needed before this lead can be Qualified"> *</span> : null}
                  </span>
                );
                if (q.fieldType === "SELECT")
                  return (
                    <label key={q.key} className="fb-ld-field" htmlFor={id}>
                      {label}
                      <select id={id} className="fb-ld-select" value={String(v)} disabled={ro} aria-invalid={missing ? true : undefined} onChange={(e) => answer(q.key, e.target.value)}>
                        <option value="">Choose…</option>
                        {q.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {q.helpText ? <span className="fb-ld-help">{String(q.helpText)}</span> : null}
                    </label>
                  );
                if (q.fieldType === "BOOLEAN")
                  return (
                    <label key={q.key} className="fb-ld-field" htmlFor={id}>
                      {label}
                      <select id={id} className="fb-ld-select" aria-invalid={missing ? true : undefined} value={v === true ? "yes" : v === false ? "no" : ""} disabled={ro} onChange={(e) => answer(q.key, e.target.value === "" ? "" : e.target.value === "yes")}>
                        <option value="">Choose…</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                  );
                if (q.fieldType === "MULTISELECT")
                  return (
                    <fieldset key={q.key} className="fb-ld-field" style={{ border: 0, padding: 0, margin: 0 }} disabled={ro}>
                      <legend style={{ fontSize: 13, fontWeight: 600, padding: 0 }}>{label}</legend>
                      {q.options.map((o) => {
                        const arr = Array.isArray(v) ? (v as string[]) : [];
                        return (
                          <label key={o.value} className="fb-ld-checkrow">
                            <input type="checkbox" checked={arr.includes(o.value)} onChange={(e) => answer(q.key, e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
                            <span>{o.label}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  );
                return (
                  <label key={q.key} className="fb-ld-field" htmlFor={id}>
                    {label}
                    <input
                      id={id}
                      className="fb-ld-input"
                      type={q.fieldType === "NUMBER" ? "number" : q.fieldType === "DATE" ? "date" : "text"}
                      value={String(v ?? "")}
                      readOnly={ro}
                      aria-invalid={missing ? true : undefined}
                      placeholder={q.helpText ? String(q.helpText) : undefined}
                      onChange={(e) => answer(q.key, q.fieldType === "NUMBER" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
                    />
                  </label>
                );
              })}
            </div>
            {qual && !qual.progress.canQualify && !qual.progress.qualified && qual.progress.missing.length ? (
              <div className="fb-ld-missing" role="note">
                Still needed before this lead can be Qualified: {qual.progress.missing.map((m) => m.label).join(", ")}.
              </div>
            ) : null}
          </section>

          <section className="fb-ld-panel fb-ld-tl" aria-label="Timeline">
            <div className="fb-ld-tl__bar">
              <div className="fb-ld-seg" role="group" aria-label="Timeline view">
                {(
                  [
                    ["all", "Activity"],
                    ["comms", "Communications"],
                    ...(canAudit ? [["audit", "Audit history"]] : []),
                  ] as [typeof tl, string][]
                ).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={tl === id} onClick={() => setTl(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {c.canEdit && can("activities.create") ? (
                <div className="fb-ld-composer">
                  {(
                    [
                      ["Call", "phone", "call"],
                      ["WhatsApp", "whatsapp", "whatsapp"],
                      ["Note", "note", "note"],
                    ] as [string, string, CommKind][]
                  ).map(([l, icon, kind]) => (
                    <button key={l} type="button" onClick={() => setNote({ kind })}>
                      <Icon name={icon} size={14} />
                      {l}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="fb-ld-tl__list">
              {timeline.map((a) => (
                <div key={a.id} className="fb-ld-tl__item">
                  <span className={`fb-ld-tl__icon ${a.kind === "comm" ? "fb-ld-tl__icon--comm" : a.kind === "sys" ? "fb-ld-tl__icon--sys" : ""}`}>
                    <Icon name={a.icon} size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fb-ld-tl__text">{a.text}</div>
                    <div className="fb-ld-tl__by">
                      {a.by} · {a.when}
                      {a.outcome ? <span className="fb-ld-tl__outcome">{a.outcome}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
              {timeline.length === 0 ? <div className="fb-ld-tl__empty">{activitiesQ.isLoading ? "Loading…" : "Nothing logged yet."}</div> : null}
            </div>
          </section>

          {/* F3.08 (M8) mounts attachments, tags, custom fields and comments here. */}
          <div data-slot="record-extras" data-record-type="lead" data-record-id={leadId} />
        </div>

        <div className="fb-ld-side">
          <section className="fb-ld-panel fb-ld-details" aria-labelledby="fb-ld-details-h">
            <h2 id="fb-ld-details-h">Details</h2>
            <label className="fb-ld-field">
              <span>Owner</span>
              <select className="fb-ld-select" value={lead.ownerMembershipId ?? ""} disabled={!c.canReassign} onChange={(e) => e.target.value && reassign(e.target.value)}>
                {!lead.ownerMembershipId ? <option value="">Unassigned</option> : null}
                {ref.owners.map((o) => (
                  <option key={o.membershipId} value={o.membershipId}>
                    {ownerLabel(o, membershipId)}
                  </option>
                ))}
                {lead.ownerMembershipId && !ref.owners.some((o) => o.membershipId === lead.ownerMembershipId) ? <option value={lead.ownerMembershipId}>{ref.memberName(lead.ownerMembershipId) ?? "Owner"}</option> : null}
              </select>
              {c.reassignLocked || c.archived ? (
                <span className="fb-ld-help">
                  <Icon name="lock" size={12} />
                  Only Management can reassign leads. Ask your Management team if this should move.
                </span>
              ) : null}
            </label>
            <div className="fb-ld-field">
              <span id="fb-ld-temp-l" className="fb-ld-label">
                Temperature
              </span>
              <div className="fb-ld-temps" role="group" aria-labelledby="fb-ld-temp-l">
                {TEMPERATURES.map((t: Temperature) => {
                  const on = lead.temperature === t;
                  const [bg, fg] = tempTone(t);
                  return (
                    <button key={t} type="button" aria-pressed={on} disabled={ro} onClick={() => !on && void patch({ temperature: t })} style={on ? { background: bg, color: fg, borderColor: fg } : undefined}>
                      {TEMPERATURE_LABEL[t]}
                    </button>
                  );
                })}
              </div>
            </div>
            {!c.converted && !ro ? (
              <label className="fb-ld-field">
                <span>Status</span>
                <select className="fb-ld-select" value={status.id} onChange={(e) => {
                  const s = ref.status(e.target.value);
                  if (s?.key === "LOST") setLost(true);
                  else if (s) void moveTo(s.key);
                }}>
                  {ref.statuses.filter((s) => s.key !== "CONVERTED" || s.id === status.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <dl className="fb-ld-kv">
              <dt>Source</dt>
              <dd>{lead.leadSource?.name ?? "—"}</dd>
              <dt>Service</dt>
              <dd>{service?.name ?? "—"}</dd>
              <dt>Created</dt>
              <dd>{fmt.date(lead.createdAt)}</dd>
              {lead.lostReason ? (
                <>
                  <dt>Lost reason</dt>
                  <dd style={{ color: "var(--red)" }}>{lead.lostReason.name}</dd>
                </>
              ) : null}
            </dl>
            {lead.notes && !webSubmission ? <p className="fb-ld-notes">{lead.notes as string}</p> : null}
          </section>

          {contact ? (
            <section className="fb-ld-panel" aria-label="Contact">
              <div className="fb-ld-eyebrow">CONTACT</div>
              <div className="fb-ld-contact">
                <span className="fb-ld-contact__ini">{contactName(contact).split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div>
                  <div style={{ fontWeight: 700 }}>{contactName(contact)}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{contact.jobTitle ?? ""}</div>
                </div>
              </div>
              <div className="fb-ld-contact__lines">
                <span>{contact.phone || "No phone"}</span>
                <span className="fb-ld-muted">{contact.email || "No email"}</span>
              </div>
              {contact.phone ? (
                <div className="fb-ld-contact__cta">
                  <a className="fb-ld-cta fb-ld-cta--primary" href={`tel:${contact.phone}`} onClick={() => c.canEdit && can("activities.create") && setTimeout(() => setNote({ kind: "call" }), 300)}>
                    <Icon name="phone" size={15} />
                    Call
                  </a>
                  <a className="fb-ld-cta" href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" onClick={() => c.canEdit && can("activities.create") && setTimeout(() => setNote({ kind: "whatsapp" }), 300)}>
                    <Icon name="whatsapp" size={15} />
                    WhatsApp
                  </a>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="fb-ld-panel" aria-labelledby="fb-ld-score-h">
            <h2 id="fb-ld-score-h">Why this score</h2>
            {scoreQ.data ? (
              <>
                <div className="fb-ld-score__big">
                  <strong>{scoreQ.data.score}</strong>
                  <span className="fb-ld-hint">{scoreQ.data.band}</span>
                </div>
                <div className="fb-ld-score">
                  {scoreQ.data.factors.map((f) => (
                    <div key={f.key} className="fb-ld-score__row">
                      <span>{f.label}</span>
                      <span className="fb-ld-score__pts">{f.points > 0 ? `+${f.points}` : f.points}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="fb-ld-hint" style={{ margin: "10px 0 0" }}>{scoreQ.isLoading ? "Working it out…" : "No score for this lead."}</p>
            )}
          </section>

          <section className="fb-ld-panel" style={{ padding: 0 }} aria-label="Tasks">
            <div className="fb-ld-tasks__head">
              <h2>Tasks</h2>
              {c.canEdit && can("tasks.create") ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--link" onClick={() => setAddTask(true)}>
                  + Add task
                </button>
              ) : null}
            </div>
            {tasks.map((t) => {
              const done = t.status === "COMPLETED";
              const ds = fmt.dueState(t.dueAt, done);
              return (
                <div key={t.id} className="fb-ld-task">
                  <button type="button" className="fb-ld-task__check" role="checkbox" aria-checked={done} aria-label={`${done ? "Reopen" : "Complete"} ${t.title}`} disabled={ro} onClick={() => toggleTask(t)}>
                    {done ? <Icon name="check" size={13} stroke={3} /> : null}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div className="fb-ld-task__title" data-done={done}>
                      {t.title}
                    </div>
                    <div className="fb-ld-task__due" style={{ color: DUE_COLOUR[ds] }}>
                      {done ? "Done" : fmt.dueLabel(t.dueAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            {tasks.length === 0 ? <div className="fb-ld-tasks__none">No tasks yet.</div> : null}
          </section>
        </div>
      </div>

      {edit ? <LeadDrawer leadId={leadId} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} /> : null}
      {convert ? (
        <ConvertDialog
          leadId={leadId}
          onClose={() => setConvert(false)}
          onDone={() => {
            setConvert(false);
            void refresh();
          }}
        />
      ) : null}
      {lost ? (
        <LostDialog
          leadId={leadId}
          name={name}
          onClose={() => setLost(false)}
          onDone={() => {
            setLost(false);
            void refresh();
          }}
        />
      ) : null}
      {note ? <NoteDrawer leadId={leadId} about={name} kind={note.kind} onClose={() => setNote(null)} /> : null}
      {addTask ? <TaskDrawer leadId={leadId} about={name} onClose={() => setAddTask(false)} /> : null}
    </div>
  );
}
