"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useApi, useApiQuery, explainRollback } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { useMember } from "../../data/member";
import { ErrorState } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMemberName, useRefreshDeals } from "./data";
import { dateLong, dateShort, initials, kes, when, type DealDetail, type HandoffRow, type HandoffStatus, type HandoffView } from "./model";

/**
 * F2.06 / P4: the Delivery Handoffs view. The left column lists every handoff the person may see; the right is the receiving view for the
 * chosen one: who owns it, the scope and requirements Sales wrote, the deliverables to tick off, the team and the onboarding tasks. Taking
 * ownership, marking it delivered and reopening are offered only when the server says this person may (`can`). Delivered moves the company to
 * Active customer on the server (B3.02).
 */

const STATUS_LABEL: Record<HandoffStatus, string> = { AWAITING_OWNER: "Awaiting owner", ONBOARDING: "Onboarding", DELIVERED: "Delivered" };
const TABS: { id: "ALL" | HandoffStatus; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "AWAITING_OWNER", label: "Awaiting owner" },
  { id: "ONBOARDING", label: "Onboarding" },
  { id: "DELIVERED", label: "Delivered" },
];

export function HandoffsScreen() {
  const member = useMember();
  const { orgSlug, can } = member;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useState<"ALL" | HandoffStatus>("ALL");
  const list = useApiQuery("getHandoffs", { params: { orgSlug }, query: { pageSize: "100" } }, { retry: false });
  const rows = ((list.data as unknown as { items?: HandoffRow[] } | undefined)?.items ?? []) as HandoffRow[];
  const counts = ((list.data as unknown as { counts?: Record<string, number> } | undefined)?.counts ?? {}) as Record<string, number>;
  const shown = tab === "ALL" ? rows : rows.filter((r) => r.status === tab);
  const wanted = params.get("deal");
  const pickId = shown.find((r) => r.dealId === wanted)?.dealId ?? rows.find((r) => r.dealId === wanted)?.dealId ?? shown[0]?.dealId ?? null;

  const mgmt = can("deals.view.all");

  return (
    <div className="fb-deals" data-screen-label="Delivery handoffs">
      <div>
        <h1 className="fb-deals__h1">Handoffs</h1>
        <div className="fb-dhand-sub">Won work handed from Sales: scope, requirements, team and start date. Just enough to begin; it isn’t a project tool.</div>
        <div style={{ marginTop: 10 }}>
          <span className="fb-dscope" data-tone={mgmt ? "org" : "own"}>
            <span className="fb-dscope__dot" aria-hidden="true" />
            {mgmt ? "Organisation" : can("handoff.manage") ? "Delivery team" : "Your deals"}
          </span>
        </div>
      </div>

      {list.isLoading ? (
        <div className="fb-dhandgrid" role="status" aria-busy="true">
          <span className="fb-sr-only">Loading handoffs</span>
          <div className="fb-dskel" style={{ height: 240 }} />
          <div className="fb-dskel" style={{ height: 420 }} />
        </div>
      ) : list.error ? (
        <div className="fb-dstate">
          <ErrorState error={list.error} area="Handoffs" onRetry={() => void list.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="fb-dstate fb-dstate--empty">
          <div className="fb-dstate__title">No handoffs yet</div>
          <div className="fb-dstate__body">When a deal is marked won, Sales hands it to Delivery here.</div>
        </div>
      ) : (
        <>
          <div className="fb-dseg fb-dseg--plain fb-dhandtabs" role="tablist" aria-label="Handoff status">
            {TABS.map((t) => {
              const n = t.id === "ALL" ? rows.length : (counts[t.id] ?? rows.filter((r) => r.status === t.id).length);
              return (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={undefined} onClick={() => setTab(t.id)}>
                  {t.label}
                  <span className="fb-dhandtabs__n">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="fb-dhandgrid">
            <ul className="fb-dhandlist" aria-label="Handoffs">
              {shown.map((h) => {
                const tone = h.status === "DELIVERED" ? "done" : h.status === "AWAITING_OWNER" ? "wait" : "work";
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="fb-dhandcard"
                      data-on={h.dealId === pickId || undefined}
                      aria-current={h.dealId === pickId ? "true" : undefined}
                      onClick={() => router.replace(`${pathname}?deal=${h.dealId}`, { scroll: false })}
                    >
                      <div className="fb-dhandcard__top">
                        <strong>{h.company?.name ?? "Company"}</strong>
                        <span className="fb-dhandstatus" data-tone={tone}>{STATUS_LABEL[h.status]}</span>
                      </div>
                      <div className="fb-dhandcard__title">{h.service?.name ?? "Deal"}</div>
                      <div className="fb-dhandcard__meta">
                        Starts {dateShort(h.startDate, member.timeZone)} · {h.deliveryOwner?.name ?? "No owner yet"}
                      </div>
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 ? <li className="fb-dcol__empty">Nothing here.</li> : null}
            </ul>
            {pickId ? <HandoffDetail key={pickId} dealId={pickId} row={rows.find((r) => r.dealId === pickId)!} /> : <div />}
          </div>
        </>
      )}
    </div>
  );
}

function HandoffDetail({ dealId, row }: { dealId: string; row: HandoffRow }) {
  const member = useMember();
  const { orgSlug, can } = member;
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const nameOf = useMemberName();
  const view = useApiQuery("getDealsByDealIdHandoff", { params: { orgSlug, dealId } }, { retry: false });
  const dealQ = useApiQuery("getDeal", { params: { orgSlug, dealId } }, { retry: false });
  const h = (view.data as unknown as { handoff: HandoffView | null } | undefined)?.handoff ?? null;
  const deal = dealQ.data as unknown as (DealDetail & { primaryContact: { firstName: string; lastName?: string } | null }) | undefined;
  const [newDeliverable, setNewDeliverable] = useState("");
  const [busy, setBusy] = useState(false);

  async function run<T>(label: string, fn: () => Promise<T>, success: string) {
    setBusy(true);
    try {
      await fn();
      refresh();
      toast.show({ tone: "success", message: success });
    } catch (e) {
      toast.show({ tone: "danger", message: explainRollback(e, label) });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (view.isLoading) return <div className="fb-dskel" style={{ height: 420 }} role="status" aria-busy="true" />;
  if (view.error || !h) {
    return (
      <div className="fb-dstate">
        <ErrorState error={view.error ?? new Error("none")} area="This handoff" onRetry={() => void view.refetch()} />
      </div>
    );
  }

  const company = h.company;
  const valueHidden = !deal || deal.valueMasked || deal.value === null;
  const valueMasked = !deal || deal.valueMasked;
  const requirements = (h.requirements ?? "").split(/\r?\n/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const statusOptions: { value: HandoffStatus; label: string; disabled: boolean }[] = [
    { value: "AWAITING_OWNER", label: "Awaiting owner", disabled: true },
    { value: "ONBOARDING", label: "Onboarding", disabled: h.status !== "DELIVERED" ? h.status !== "ONBOARDING" : !h.can.reopen },
    { value: "DELIVERED", label: "Delivered", disabled: h.status !== "DELIVERED" && !h.can.markDelivered },
  ];
  const noChange = !h.can.markDelivered && !h.can.reopen;

  const setDeliverables = (next: { title: string; done: boolean }[], success: string) =>
    run("Updating the deliverables", () => api.call("patchDealsByDealIdHandoff", { params: { orgSlug, dealId }, body: { deliverables: next } }), success);

  return (
    <section className="fb-dhandview" aria-label={`Handoff for ${company?.name ?? "this deal"}`} data-screen-label="Delivery receiving view">
      <div className="fb-dhandview__head">
        <div>
          <div className="fb-dmonohead fb-dmonohead--tight">
            WON {dateShort(deal?.wonAt ?? h.createdAt, member.timeZone).toUpperCase()} · FROM {deal ? nameOf(deal.ownerMembershipId).toUpperCase() : "SALES"}
          </div>
          <h2 className="fb-dhandview__title">{company?.name}</h2>
          <div className="fb-dhandview__line">
            {deal?.service?.name ?? "Deal"} · <span style={{ color: "var(--text-3)" }}>{valueHidden ? (valueMasked ? `Pricing not shown for ${member.roleName}` : "No value yet") : kes(Number(deal!.value), deal!.currency)}</span>
          </div>
        </div>
        <div className="fb-deals__tools" style={{ alignItems: "flex-start" }}>
          {h.can.take ? (
            <button type="button" className="fb-dtool fb-dtool--primary" disabled={busy} onClick={() => void run("Taking the handoff", () => api.call("postDealsByDealIdHandoffTake", { params: { orgSlug, dealId }, idempotencyKey: newIdempotencyKey() }), `You own the ${company?.name} handoff.`)}>
              Take ownership
            </button>
          ) : null}
          <select
            className="fb-dstatusselect"
            aria-label="Delivery status"
            value={h.status}
            disabled={noChange || busy}
            title={noChange ? "Only the Delivery owner can change this." : undefined}
            onChange={(e) => {
              const status = e.target.value as "ONBOARDING" | "DELIVERED";
              void run("Changing the status", () => api.call("patchDealsByDealIdHandoff", { params: { orgSlug, dealId }, body: { status } }), status === "DELIVERED" ? "Status: Delivered · customer is now Active." : "Status: Onboarding.");
            }}
          >
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled && o.value !== h.status}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="fb-dhandfacts">
        {[
          { k: "DELIVERY OWNER", v: h.deliveryOwner?.name ?? "Not assigned" },
          { k: "START DATE", v: dateLong(h.startDate, member.timeZone) },
          { k: "PRIMARY CONTACT", v: deal?.primaryContact ? `${deal.primaryContact.firstName} ${deal.primaryContact.lastName ?? ""}`.trim() : "—" },
          { k: "STATUS", v: STATUS_LABEL[h.status] },
        ].map((f) => (
          <div key={f.k} className="fb-dhandfact">
            <div className="fb-dmonohead fb-dmonohead--tight">{f.k}</div>
            <div className="fb-dhandfact__v">{f.v}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="fb-dh3">Scope</h3>
        <p className="fb-dhandview__p">{h.scope || "No scope was written. Ask the deal owner."}</p>
      </div>

      <div className="fb-dhand2col">
        <div>
          <h3 className="fb-dh3">Requirements</h3>
          {requirements.length ? (
            <ul className="fb-dhandview__ul">
              {requirements.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          ) : (
            <div className="fb-dmuted">Sales didn’t attach requirements. Capture them at kickoff.</div>
          )}
        </div>
        <div>
          <h3 className="fb-dh3">Deliverables</h3>
          {h.deliverables.map((x, i) => (
            <label key={`${x.title}-${i}`} className="fb-dhandview__check">
              <input
                type="checkbox"
                checked={x.done}
                disabled={!h.can.edit || busy}
                onChange={() => void setDeliverables(h.deliverables.map((y, j) => (j === i ? { ...y, done: !y.done } : y)), "Deliverable updated.")}
              />
              <span style={{ textDecoration: x.done ? "line-through" : "none", color: x.done ? "var(--text-3)" : "var(--text)" }}>{x.title}</span>
            </label>
          ))}
          {h.can.edit ? (
            <form
              className="fb-dhandview__add"
              onSubmit={(e) => {
                e.preventDefault();
                const title = newDeliverable.trim();
                if (!title) return;
                setNewDeliverable("");
                void setDeliverables([...h.deliverables, { title, done: false }], "Deliverable added.");
              }}
            >
              <input className="fb-dm__input" aria-label="New deliverable" placeholder="+ Add deliverable" value={newDeliverable} onChange={(e) => setNewDeliverable(e.target.value)} />
            </form>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="fb-dh3">Assigned team</h3>
        <div className="fb-dteam">
          {(h.team.length ? h.team : h.deliveryOwner ? [h.deliveryOwner] : []).map((t) => (
            <span key={t.membershipId} className="fb-dteam__chip">
              <span className="fb-dteam__ini" aria-hidden="true">{initials(t.name ?? "?")}</span>
              {t.name}
            </span>
          ))}
          {h.team.length === 0 && !h.deliveryOwner ? <span className="fb-dmuted">Nobody yet. Take ownership to start.</span> : null}
        </div>
      </div>

      <div>
        <h3 className="fb-dh3">Onboarding tasks</h3>
        {h.tasks.length ? (
          h.tasks.map((t) => {
            const done = t.status === "COMPLETED";
            const overdue = !done && t.dueAt ? new Date(t.dueAt) < new Date() : false;
            return (
              <div key={t.id} className="fb-dhandtask">
                <span style={{ flex: 1, fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>{t.title}</span>
                <span style={{ color: overdue ? "var(--red)" : "var(--text-2)", fontWeight: 600 }}>{done ? "Done" : overdue ? `Overdue · ${when(t.dueAt, member.timeZone, member.hour12)}` : when(t.dueAt, member.timeZone, member.hour12)}</span>
                <span className="fb-dmuted">{nameOf(t.assigneeMembershipId)}</span>
              </div>
            );
          })
        ) : (
          <div className="fb-dmuted">{h.status === "AWAITING_OWNER" ? "Onboarding tasks are created when someone takes this handoff." : "No onboarding tasks."}</div>
        )}
      </div>

      <div className="fb-dhandview__actions">
        {can("companies.view") && company ? (
          <Link href={`/o/${orgSlug}/companies/${company.id}`} className="fb-dtool fb-dtool--sm">
            Open Customer 360
          </Link>
        ) : null}
        <Link href={`/o/${orgSlug}/deals/${dealId}`} className="fb-dtool fb-dtool--sm">
          Open the deal
        </Link>
      </div>
      <span className="fb-sr-only">{row.status}</span>
    </section>
  );
}
