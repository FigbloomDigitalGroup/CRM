"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError } from "@/api-client";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { Icon } from "../leads/icons";
import { DUE_COLOUR } from "../leads/format";
import { ModalShell } from "../leads/overlay";
import { useCallLogPrompt, ReachButtons } from "../contacts/QuickLogPrompt";
import { RecordExtras } from "../extras/RecordExtras";
import { ArchiveDialog } from "./ArchiveDialog";
import { CompanyDrawer } from "./CompanyDrawer";
import { LogActivityDrawer } from "./LogActivityDrawer";
import { MergeDialog } from "./merge/MergeDialog";
import {
  humanise,
  initialsFrom,
  invoiceTone,
  lifecycleTone,
  stageDot,
  useCustomerReference,
  useFormatters,
  type Customer360,
  type SectionResult,
  type TimelineItem,
} from "./data";

type Denied = Extract<SectionResult<unknown>, { status: "no_access" }>;

/** An explained absence: what is missing, why, and who owns it (the design's S4 inside a panel). */
function SectionNote({ section, area }: { section: Denied | Extract<SectionResult<unknown>, { status: "not_available" }>; area: string }) {
  const owners = "ownerRoles" in section && section.ownerRoles.length ? ` Ask ${section.ownerRoles.join(" or ")}.` : "";
  return (
    <div className="fb-cu-note" role="note" aria-label={`${area} is not available to you`}>
      <Icon name="lock" size={15} />
      <span>
        {section.reason}
        {owners}
      </span>
    </div>
  );
}

const ICON_FOR: Record<string, string> = { CALL: "phone", WHATSAPP: "whatsapp", EMAIL: "mail", MEETING: "users", NOTE: "note", OTHER: "message" };

function timelineIcon(item: TimelineItem): { icon: string; bg: string; fg: string } {
  if (item.kind === "LIFECYCLE") return { icon: "swap", bg: "var(--blue-soft)", fg: "var(--blue)" };
  if (item.kind === "AUDIT") return { icon: "shield", bg: "var(--surface-3)", fg: "var(--text-2)" };
  const key = String(item.kind === "COMMUNICATION" ? item.channel : item.type ?? "NOTE").toUpperCase();
  const reach = ["CALL", "WHATSAPP", "EMAIL", "MEETING"].includes(key);
  return { icon: ICON_FOR[key] ?? "message", bg: reach ? "var(--primary-soft)" : "var(--surface-3)", fg: reach ? "var(--primary-text)" : "var(--text-2)" };
}

/**
 * Customer 360 (C2, FIG-1095): everything about one customer on one page, each part loaded and permitted on its own. A part the signed-in
 * role may not read is explained in words (who owns it and why), never silently dropped; payments are for Finance and Management only, so the
 * panel is absent for everyone else and the Outstanding tile says "Finance only". An archived company is read-only until it is restored.
 */
export function CompanyDetailScreen({ companyId }: { companyId: string }) {
  const { orgSlug, can } = useMember();
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormatters();
  const ref = useCustomerReference();
  const prompt = useCallLogPrompt();
  const q = useApiQuery("getCustomer360", { params: { orgSlug, companyId }, query: {} });
  const data = q.data as unknown as Customer360 | undefined;
  const [drawer, setDrawer] = useState<"edit" | "log" | null>(null);
  const [merging, setMerging] = useState(false);
  const [survivor, setSurvivor] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [lifeTo, setLifeTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState<{ items: TimelineItem[]; nextCursor: string | null } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["getCustomer360"] });

  if (q.error instanceof ApiRequestError && q.error.status === 403) return <NoAccess area="Companies" denial={describeError(q.error).denial} />;
  if (q.error instanceof ApiRequestError && q.error.status === 404) {
    return (
      <div className="fb-cu" data-screen-label="Customer 360">
        <Link href={`/o/${orgSlug}/companies`} className="fb-cu-back">
          <Icon name="arrow-left" size={15} />
          Companies
        </Link>
        <div className="fb-cu-card fb-cu-state" role="alert">
          <div className="fb-cu-state__title">This company was not found</div>
          <div className="fb-cu-state__body">It may have been merged into another company or removed from your view.</div>
        </div>
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="fb-cu" data-screen-label="Customer 360">
        <div role="alert" className="fb-cu-card fb-cu-state">
          <div className="fb-cu-state__icon">
            <Icon name="alert" size={24} />
          </div>
          <div className="fb-cu-state__title">This customer didn’t load</div>
          <div className="fb-cu-state__body">Check your connection. Nothing was lost.</div>
          <div className="fb-cu-state__row">
            <button type="button" className="fb-ld-btn fb-ld-btn--md fb-ld-btn--primary" onClick={() => q.refetch()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="fb-cu" data-screen-label="Customer 360" aria-busy="true">
        <div className="fb-cu-skel" style={{ width: 260, height: 28 }} />
        <div className="fb-cu-summary">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="fb-cu-fact">
              <div className="fb-cu-skel" style={{ width: "60%" }} />
            </div>
          ))}
        </div>
        <div className="fb-cu-panel">
          <div className="fb-cu-skel" style={{ width: "80%" }} />
        </div>
      </div>
    );
  }

  const s = data.sections;
  const profile = s.profile?.status === "ok" ? s.profile.data : null;
  if (!profile) return <NoAccess area="Companies" />;
  const archived = data.company.archived;
  const canEdit = can("companies.edit") && !archived;
  const canLife = canEdit;
  const [lbg, lfg] = lifecycleTone(profile.lifecycle.state?.key);
  const ownerName = profile.owner?.name ?? "Unassigned";

  const deals = s.deals?.status === "ok" ? s.deals.data : null;
  const tasks = s.tasks?.status === "ok" ? s.tasks.data : null;
  const timeline = s.timeline?.status === "ok" ? s.timeline.data : null;
  const services = s.services?.status === "ok" ? s.services.data : null;
  const payments = s.payments?.status === "ok" ? s.payments.data : null;
  const handoffs = s.handoffs?.status === "ok" ? s.handoffs.data : null;
  const next = s.nextFollowUp?.status === "ok" ? s.nextFollowUp.data.next : null;

  const openDeals = (deals?.items ?? []).filter((d) => d.outcome === "OPEN" || !d.outcome);
  const wonDeals = (deals?.items ?? []).filter((d) => d.outcome === "WON");
  const sumOf = (list: typeof openDeals) => {
    if (list.some((d) => d.valueMasked || d.value === null)) return null;
    const total = list.reduce((a, d) => a + Number(d.value), 0);
    return `${list[0]?.currency ?? "KES"} ${total.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
  };
  const dealsDenied = s.deals && s.deals.status !== "ok";
  const openSum = deals ? (openDeals.length ? sumOf(openDeals) : "No value yet") : null;
  const wonSum = deals ? (wonDeals.length ? sumOf(wonDeals) : "—") : null;

  const timelineItems = [...(timeline?.items ?? []), ...(more?.items ?? [])];
  const timelineCursor = more ? more.nextCursor : (timeline?.nextCursor ?? null);

  async function loadMore() {
    if (!timelineCursor) return;
    try {
      const r = (await api.call("getCustomer360", { params: { orgSlug, companyId }, query: { sections: "timeline", cursor: timelineCursor } as never })) as unknown as Customer360;
      const t = r.sections.timeline;
      if (t?.status === "ok") setMore({ items: [...(more?.items ?? []), ...t.data.items], nextCursor: t.data.nextCursor });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    }
  }

  async function changeLifecycle() {
    if (!lifeTo || !reason.trim()) return;
    const previous = profile!.lifecycle.state;
    setBusy(true);
    try {
      await api.call("setCompanyLifecycle", { params: { orgSlug, companyId }, body: { stateId: lifeTo, reason: reason.trim() }, idempotencyKey: newIdempotencyKey() } as never);
      await qc.invalidateQueries();
      setLifeTo(null);
      setReason("");
      const nowName = ref.states.find((x) => x.id === lifeTo)?.name ?? "the new state";
      toast.show({
        tone: "success",
        message: `Lifecycle: ${nowName}`,
        undo: previous
          ? async () => {
              await api.call("setCompanyLifecycle", { params: { orgSlug, companyId }, body: { stateId: previous.id, reason: "Undone" }, idempotencyKey: newIdempotencyKey() } as never);
              await qc.invalidateQueries();
            }
          : undefined,
      });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    } finally {
      setBusy(false);
    }
  }

  async function releaseLifecycle() {
    try {
      await api.call("releaseCompanyLifecycle", { params: { orgSlug, companyId } } as never);
      await qc.invalidateQueries();
      toast.show({ tone: "success", message: "The lifecycle follows the system again." });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    }
  }

  async function setArchived(on: boolean) {
    setBusy(true);
    try {
      await api.call(on ? "postCompaniesByCompanyIdArchive" : "postCompaniesByCompanyIdRestore", { params: { orgSlug, companyId }, ...(on ? { body: {} } : {}), idempotencyKey: newIdempotencyKey() } as never);
      await qc.invalidateQueries();
      setArchiving(false);
      toast.show({
        tone: "success",
        message: on ? `${profile!.name} archived.` : `${profile!.name} restored.`,
        undo: async () => {
          await api.call(on ? "postCompaniesByCompanyIdRestore" : "postCompaniesByCompanyIdArchive", { params: { orgSlug, companyId }, ...(on ? {} : { body: {} }), idempotencyKey: newIdempotencyKey() } as never);
          await qc.invalidateQueries();
        },
      });
    } catch (e) {
      setArchiving(false);
      toast.show({ tone: "danger", message: describeError(e).body });
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = archived || !can("companies.edit") ? "Read-only" : can("membership.manage") ? "Organisation" : "Shared";
  const scopeTone = archived || !can("companies.edit") ? "fb-ld-scope--ro" : can("membership.manage") ? "fb-ld-scope--org" : "fb-ld-scope--own";
  const requirements = [...new Set((handoffs?.items ?? []).flatMap((h) => h.requirements ?? []))];
  const byName = (id: unknown) => (typeof id === "string" ? ref.ownerName(id) : null);

  return (
    <div className="fb-cu" data-screen-label="Customer 360">
      <Link href={`/o/${orgSlug}/companies`} className="fb-cu-back">
        <Icon name="arrow-left" size={15} />
        Companies
      </Link>

      {archived ? (
        <div role="status" className="fb-cu-banner">
          <Icon name="archive" size={17} />
          <span>
            <strong>Archived.</strong> Everything on this customer is read-only until it’s restored.
            {profile.mergedIntoId ? (
              <>
                {" "}
                It was merged into <Link href={`/o/${orgSlug}/companies/${profile.mergedIntoId}`}>another company</Link>.
              </>
            ) : null}
          </span>
          {can("companies.archive") ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--sm" disabled={busy} onClick={() => setArchived(false)}>
              Restore
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="fb-cu-head">
        <div className="fb-cu-id">
          <span className="fb-cu-logo" aria-hidden="true">
            {initialsFrom(profile.name)}
          </span>
          <div>
            <div className="fb-cu-namerow">
              <h1 className="fb-cu-title">{profile.name}</h1>
              <span className="fb-cu-lc" style={{ background: lbg, color: lfg }}>
                {profile.lifecycle.state?.name ?? "No state"}
              </span>
            </div>
            <div className="fb-cu-line">
              <span>{[profile.industry, profile.location].filter(Boolean).join(" · ") || "No industry or location yet"}</span>
              <span className={`fb-ld-scope ${scopeTone}`}>
                <span className="fb-ld-scope__dot" />
                {scopeLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="fb-cu-actions">
          {can("activities.create") && !archived ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer("log")}>
              <Icon name="phone" size={16} />
              Log activity
            </button>
          ) : null}
          {canEdit && can("deals.create") ? (
            <Link href={`/o/${orgSlug}/deals`} className="fb-ld-btn">
              <Icon name="briefcase" size={16} />
              New deal
            </Link>
          ) : null}
          {canEdit ? (
            <button type="button" className="fb-ld-btn" onClick={() => setDrawer("edit")}>
              <Icon name="pencil" size={16} />
              Edit
            </button>
          ) : null}
          {canEdit && can("companies.merge") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setMerging(true)}>
              <Icon name="merge" size={16} />
              Merge
            </button>
          ) : null}
          {!archived && can("companies.archive") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setArchiving(true)}>
              <Icon name="archive" size={16} />
              Archive
            </button>
          ) : null}
        </div>
      </div>

      <div className="fb-cu-summary">
        <div className="fb-cu-fact">
          <div className="fb-cu-fact__k">LIFECYCLE</div>
          {canLife ? (
            <select aria-label="Lifecycle" value={profile.lifecycle.state?.id ?? ""} onChange={(e) => e.target.value && e.target.value !== profile.lifecycle.state?.id && setLifeTo(e.target.value)}>
              {!profile.lifecycle.state ? <option value="">No state</option> : null}
              {ref.states.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="fb-cu-fact__v">{profile.lifecycle.state?.name ?? "No state"}</div>
          )}
          {profile.lifecycle.manual ? (
            <div className="fb-cu-fact__manual">
              Set by hand; the daily check leaves it alone.
              {canLife ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--link" onClick={releaseLifecycle}>
                  Let the system decide
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="fb-cu-fact">
          <div className="fb-cu-fact__k">NEXT FOLLOW-UP</div>
          {s.nextFollowUp?.status === "no_access" ? (
            <>
              <div className="fb-cu-fact__v" data-muted="true">Not for your role</div>
              <div className="fb-cu-fact__sub">{s.nextFollowUp.reason}</div>
            </>
          ) : (
            <>
              <div className="fb-cu-fact__v" style={{ color: next?.at ? DUE_COLOUR[fmt.dueState(next.at)] : undefined }}>
                {next ? (next.at ? fmt.dueLabel(next.at) : "No date") : "None set"}
              </div>
              <div className="fb-cu-fact__sub">{next ? next.title : "Add a task so it isn’t forgotten"}</div>
            </>
          )}
        </div>
        <div className="fb-cu-fact">
          <div className="fb-cu-fact__k">OPEN DEALS</div>
          {dealsDenied ? (
            <>
              <div className="fb-cu-fact__v" data-muted="true">Not for your role</div>
              <div className="fb-cu-fact__sub">Your role cannot open deals</div>
            </>
          ) : (
            <>
              <div className="fb-cu-fact__v">{openDeals.length}</div>
              <div className="fb-cu-fact__sub">{openSum ?? "Values hidden"}</div>
            </>
          )}
        </div>
        <div className="fb-cu-fact">
          <div className="fb-cu-fact__k">WON TO DATE</div>
          {dealsDenied ? (
            <div className="fb-cu-fact__v" data-muted="true">—</div>
          ) : (
            <>
              <div className="fb-cu-fact__v" data-muted={wonSum === null || undefined}>{wonSum ?? "Values hidden"}</div>
              <div className="fb-cu-fact__sub">
                {wonDeals.length} won deal{wonDeals.length === 1 ? "" : "s"}
              </div>
            </>
          )}
        </div>
        <div className="fb-cu-fact">
          <div className="fb-cu-fact__k">OUTSTANDING</div>
          {payments ? (
            <>
              <div className="fb-cu-fact__v" style={{ color: Number(payments.totals.outstanding) > 0 ? "var(--orange-text)" : undefined }}>
                {Number(payments.totals.outstanding).toLocaleString("en-KE", { maximumFractionDigits: 0 })}
              </div>
              <div className="fb-cu-fact__sub">{payments.totals.overdueInvoices} overdue invoice(s)</div>
            </>
          ) : (
            <>
              <div className="fb-cu-fact__v" data-muted="true">Finance only</div>
              <div className="fb-cu-fact__sub">Ask Finance</div>
            </>
          )}
        </div>
        <div className="fb-cu-fact">
          <div className="fb-cu-fact__k">OWNER</div>
          <div className="fb-cu-fact__v">{ownerName}</div>
          <div className="fb-cu-fact__sub">{profile.phone ?? ""}</div>
        </div>
      </div>

      <div className="fb-cu-cols">
        <div className="fb-cu-main">
          <section className="fb-cu-panel" aria-label="Services and projects">
            <h2>Services and projects</h2>
            {s.services?.status === "no_access" ? (
              <SectionNote section={s.services} area="Services" />
            ) : (
              <>
                <div className="fb-cu-tiles">
                  {(services?.services ?? []).map((x) => (
                    <div key={x.id} className="fb-cu-svc">
                      <div className="fb-cu-svc__top">
                        <strong>{x.name}</strong>
                        <span className="fb-cu-svc__tag" style={x.status === "ACTIVE" ? { background: "var(--primary-soft)", color: "var(--primary-text)" } : { background: "var(--blue-soft)", color: "var(--blue)" }}>
                          {x.status === "ACTIVE" ? "Live" : humanise(x.status)}
                        </span>
                      </div>
                      {x.notes ? <div className="fb-cu-svc__l">{x.notes}</div> : null}
                      <div className="fb-cu-svc__since">Since {fmt.date(x.startDate)}</div>
                    </div>
                  ))}
                  {(services?.recurring ?? []).map((r) => (
                    <div key={r.id} className="fb-cu-svc">
                      <div className="fb-cu-svc__top">
                        <strong>{r.serviceName}</strong>
                        <span
                          className="fb-cu-svc__tag"
                          style={r.state === "ACTIVE" ? { background: "var(--primary-soft)", color: "var(--primary-text)" } : r.state === "DUE_SOON" ? { background: "var(--purple-soft)", color: "var(--purple)" } : r.state === "LAPSED" ? { background: "var(--red-soft)", color: "var(--red)" } : { background: "var(--blue-soft)", color: "var(--blue)" }}
                        >
                          {r.state === "DUE_SOON" ? "Renewal due" : humanise(r.state)}
                        </span>
                      </div>
                      <div className="fb-cu-svc__l">
                        Renews {fmt.date(r.renewsOn)} · {humanise(r.billingCycle)}
                        {r.valueMasked ? "" : r.value ? ` · ${r.currency} ${Number(r.value).toLocaleString("en-KE", { maximumFractionDigits: 0 })}` : ""}
                      </div>
                      <div className="fb-cu-svc__since">Since {fmt.date(r.startsOn)}</div>
                    </div>
                  ))}
                </div>
                {!(services?.services.length || services?.recurring.length) ? <div className="fb-cu-empty">No services yet. They appear here once a deal is won.</div> : null}
              </>
            )}
          </section>

          {requirements.length ? (
            <section className="fb-cu-panel" aria-label="Requirements">
              <h2>Requirements</h2>
              <ul className="fb-cu-list">
                {requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="fb-cu-panel fb-cu-panel--flush" aria-label="Deals, quotes and proposals">
            <div className="fb-cu-panel__head">
              <h2>Deals, quotes and proposals</h2>
            </div>
            {s.deals?.status === "no_access" ? <SectionNote section={s.deals} area="Deals" /> : null}
            {deals?.items.map((d) => (
              <Link key={d.id} href={`/o/${orgSlug}/deals/${d.id}`} className="fb-cu-deal">
                <span className="fb-cu-deal__dot" style={{ background: stageDot(d.stage, d.outcome) }} />
                <span className="fb-cu-deal__body">
                  <span className="fb-cu-deal__title">{d.service ?? "Deal"}</span>
                  <span className="fb-cu-deal__meta">
                    {d.stage} · {d.owner?.name ?? "Unassigned"}
                  </span>
                </span>
                <span className="fb-cu-deal__value" data-masked={d.valueMasked || d.value === null || undefined}>
                  {d.valueMasked ? "Value hidden" : d.value === null ? "No value yet" : `${d.currency} ${Number(d.value).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`}
                </span>
              </Link>
            ))}
            {deals && deals.items.length === 0 ? <div className="fb-cu-none">No deals in your view.</div> : null}
          </section>

          <section className="fb-cu-panel fb-cu-panel--flush" aria-label="Communication and activity">
            <div className="fb-cu-panel__head fb-cu-panel__head--rule">
              <h2>Communication and activity</h2>
              <span className="fb-cu-panel__note">Company, deals and leads together</span>
            </div>
            {s.timeline?.status === "no_access" ? <SectionNote section={s.timeline} area="Communication" /> : null}
            {timeline ? (
              <div className="fb-cu-tl">
                {timelineItems.map((a) => {
                  const ic = timelineIcon(a);
                  const by = byName(a.authorMembershipId ?? a.actorMembershipId);
                  return (
                    <div key={`${a.kind}-${a.id}`} className="fb-cu-tl__item">
                      <span className="fb-cu-tl__icon" style={{ background: ic.bg, color: ic.fg }}>
                        <Icon name={ic.icon} size={15} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="fb-cu-tl__text">
                          {a.title}
                          {a.detail ? ` — ${a.detail}` : ""}
                        </div>
                        <div className="fb-cu-tl__by">
                          {by ?? (a.kind === "LIFECYCLE" ? "Figbloom" : "Team member")} · {fmt.when(a.at)} · {a.kind === "LIFECYCLE" ? "Lifecycle" : a.dealId ? "Deal" : a.leadId ? "Lead" : "Customer"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {timelineItems.length === 0 ? <div className="fb-cu-empty" style={{ padding: "20px 0" }}>Nothing logged yet.</div> : null}
                {timelineCursor ? (
                  <div className="fb-cu-tl__more">
                    <button type="button" className="fb-ld-btn fb-ld-btn--sm" onClick={loadMore}>
                      Show older
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <RecordExtras kind="company" id={companyId} archived={archived} />
        </div>

        <div className="fb-cu-side">
          <section className="fb-cu-panel fb-cu-panel--flush" aria-label="Contacts">
            <div className="fb-cu-panel__head">
              <h2>Contacts</h2>
              {canEdit && can("contacts.create") ? (
                <Link href={`/o/${orgSlug}/contacts?new=1&companyId=${companyId}`} className="fb-cu-add">
                  + Add
                </Link>
              ) : null}
            </div>
            {profile.contacts.map((p) => (
              <div key={p.id} className="fb-cu-contact">
                <span className="fb-cu-contact__ini">{initialsFrom(p.name)}</span>
                <Link href={`/o/${orgSlug}/contacts/${p.id}`} className="fb-cu-contact__body">
                  <span className="fb-cu-contact__name">{p.name}</span>
                  <span className="fb-cu-contact__title">{p.jobTitle ?? ""}</span>
                </Link>
                {can("activities.create") ? <ReachButtons name={p.name} phone={p.phone} target={{ contactId: p.id, name: p.name.split(" ")[0] ?? p.name }} begin={prompt.begin} variant="card" /> : null}
              </div>
            ))}
            {profile.contacts.length === 0 ? <div className="fb-cu-none">No contacts yet.</div> : null}
          </section>

          <section className="fb-cu-panel fb-cu-panel--flush" aria-label="Tasks">
            <div className="fb-cu-panel__head">
              <h2>Tasks</h2>
            </div>
            {s.tasks?.status === "no_access" ? <SectionNote section={s.tasks} area="Tasks" /> : null}
            {tasks?.items.map((t) => {
              const st = fmt.dueState(t.dueAt);
              return (
                <div key={t.id} className="fb-cu-task">
                  <span className="fb-cu-task__dot" style={{ background: DUE_COLOUR[st] }} />
                  <div>
                    <div className="fb-cu-task__title">{t.title}</div>
                    <div className="fb-cu-task__due" style={{ color: DUE_COLOUR[st] }}>
                      {fmt.dueLabel(t.dueAt)} · {t.assignee?.name ?? "Unassigned"}
                    </div>
                  </div>
                </div>
              );
            })}
            {tasks && tasks.items.length === 0 ? <div className="fb-cu-none">No open tasks.</div> : null}
          </section>

          <section className="fb-cu-panel" aria-label="Outstanding issues">
            <h2>Outstanding issues</h2>
            {s.tickets?.status === "not_available" ? (
              <div className="fb-cu-empty">Nothing outstanding. {s.tickets.reason}</div>
            ) : (
              <div className="fb-cu-empty">Nothing outstanding.</div>
            )}
          </section>

          {payments ? (
            <section className="fb-cu-panel fb-cu-panel--flush" aria-label="Payments">
              <div className="fb-cu-panel__head">
                <h2>Payments</h2>
                <span className="fb-cu-panel__note">Finance and Management</span>
              </div>
              {payments.items.map((i) => {
                const [bg, fg] = invoiceTone(i.status);
                return (
                  <div key={i.id} className="fb-cu-pay">
                    <div className="fb-cu-pay__body">
                      <div className="fb-cu-pay__no">{i.number}</div>
                      <div className="fb-cu-pay__due">Due {fmt.date(i.dueOn)}</div>
                    </div>
                    <div className="fb-cu-pay__amt">
                      <div>
                        {i.currency} {Number(i.amount).toLocaleString("en-KE", { maximumFractionDigits: 0 })}
                      </div>
                      <span className="fb-cu-pay__tag" style={{ background: bg, color: fg }}>
                        {humanise(i.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {payments.items.length === 0 ? <div className="fb-cu-none">No invoices tracked.</div> : null}
              {payments.followUpNotes.map((n) => (
                <div key={n.dealId} className="fb-cu-note">
                  <Icon name="note" size={15} />
                  <span>
                    {n.note}
                    {n.nextOn ? ` · next ${fmt.dshort(n.nextOn)}` : ""}
                  </span>
                </div>
              ))}
              {can("finance.view.payments") ? (
                <div className="fb-cu-note">
                  <Icon name="wallet" size={15} />
                  <Link href={`/o/${orgSlug}/payments`} className="fb-cu-add">
                    Open the payments tracker
                  </Link>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      {drawer === "edit" ? (
        <CompanyDrawer
          companyId={companyId}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            void refresh();
          }}
        />
      ) : null}
      {drawer === "log" ? <LogActivityDrawer companyId={companyId} about={profile.name} onClose={() => setDrawer(null)} /> : null}
      {merging ? (
        <MergeDialog
          kind="company"
          id={companyId}
          onClose={() => {
            setMerging(false);
            // A merge that kept the other record leaves this page archived: go to the one that survived.
            if (survivor && survivor !== companyId) router.replace(`/o/${orgSlug}/companies/${survivor}`);
            else void refresh();
            setSurvivor(null);
          }}
          onMerged={setSurvivor}
          onUndone={() => setSurvivor(null)}
        />
      ) : null}
      {archiving ? <ArchiveDialog title={`Archive ${profile.name}?`} busy={busy} onCancel={() => setArchiving(false)} onConfirm={() => setArchived(true)} /> : null}
      {lifeTo ? (
        <ModalShell
          title="Change lifecycle"
          intro={`Move ${profile.name} to ${ref.states.find((x) => x.id === lifeTo)?.name ?? "the new state"}. A reason goes on the timeline and in the audit log.`}
          onClose={() => (setLifeTo(null), setReason(""))}
          label="Change lifecycle"
          footer={
            <>
              <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => (setLifeTo(null), setReason(""))}>
                Cancel
              </button>
              <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={busy || !reason.trim()} onClick={changeLifecycle}>
                Change lifecycle
              </button>
            </>
          }
        >
          <label className="fb-ld-field">
            <span>Why are you changing it? *</span>
            <textarea className="fb-ld-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
          <p className="fb-ld-footnote">Changed by hand, the daily check will leave this company alone until you let the system decide again.</p>
        </ModalShell>
      ) : null}
      {prompt.element}
    </div>
  );
}
