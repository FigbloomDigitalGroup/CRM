"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Package } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useApi, useApiQuery, explainRollback } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { DEALS_KEY, useRefreshDeals } from "./data";
import { DealModal } from "./Modal";
import { stageTone, type DealItem, type MoveCheckResult, type MoveResult, type RefData, type Stage } from "./model";

/**
 * Moving a deal, in one place (F2.04, F2.05; B2.06). The board's drop, the card's Move to menu, the stage stepper and Mark won all call
 * `requestMove`. It asks the server what the move needs (`move-check`) and answers for it: a lost stage asks for a reason, won opens the
 * Delivery handoff, a refused move says why in plain words. The change shows at once and is put back, with the reason, if the server says no.
 * Nothing here moves a deal on its own: every move starts with a person.
 */

export interface MoveTarget {
  id: string;
  company: string;
  stageId: string;
  outcome: "OPEN" | "WON" | "LOST";
  valueLabel?: string;
  title?: string;
}

type Dialog = { kind: "moveTo"; target: MoveTarget } | { kind: "lost"; target: MoveTarget; stage: Stage } | { kind: "handoff"; target: MoveTarget; stage: Stage };

interface HandoffForm {
  ownerId: string;
  startDate: string;
  scope: string;
  template: boolean;
  lifecycle: boolean;
}

export function useDealMover(ref: RefData | undefined) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const { orgSlug } = useMember();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  /** Shows the move straight away on the board and the detail page; returns what puts it back. */
  function applyLocal(dealId: string, stage: Stage): () => void {
    const outcome = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";
    const snapshots: [readonly unknown[], unknown][] = [];
    for (const [key, data] of qc.getQueriesData<{ items: DealItem[] }>({ queryKey: [DEALS_KEY, "all"] })) {
      if (!data) continue;
      snapshots.push([key, data]);
      qc.setQueryData(key, { ...data, items: data.items.map((d) => (d.id === dealId ? { ...d, pipelineStageId: stage.id, pipelineStage: { ...d.pipelineStage, ...stage }, outcome } : d)) });
    }
    const detailKey = ["getDeal", { orgSlug, dealId }, null];
    const detail = qc.getQueryData<Record<string, unknown>>(detailKey);
    if (detail) {
      snapshots.push([detailKey, detail]);
      qc.setQueryData(detailKey, { ...detail, pipelineStageId: stage.id, pipelineStage: { ...(detail.pipelineStage as object), ...stage }, outcome });
    }
    return () => {
      for (const [key, data] of snapshots) qc.setQueryData(key, data);
    };
  }

  /** Runs the move. Returns the message to show inside a dialog when it is refused, or null when it went through. */
  async function perform(target: MoveTarget, stage: Stage, extra: { lostReasonId?: string; handoff?: Record<string, unknown> } = {}): Promise<string | null> {
    const rollback = applyLocal(target.id, stage);
    try {
      const res = (await api.call("postDealsByDealIdMove", {
        params: { orgSlug, dealId: target.id },
        body: { pipelineStageId: stage.id, ...(extra.lostReasonId ? { lostReasonId: extra.lostReasonId } : {}), ...(extra.handoff ? { handoff: extra.handoff } : {}) },
        idempotencyKey: newIdempotencyKey(),
      })) as unknown as MoveResult;
      refresh();
      const moveId = res.move?.id;
      if (res.move?.undoable && moveId) {
        toast.show({
          message: stage.isLost ? `${target.company} marked lost.` : `${target.company} moved to ${stage.name}.`,
          undo: async () => {
            try {
              await api.call("postDealMovesByMoveIdUndo", { params: { orgSlug, moveId }, idempotencyKey: newIdempotencyKey() });
              refresh();
              toast.show({ message: `Move undone. ${target.company} is back in its previous stage.` });
            } catch (error) {
              toast.show({ tone: "danger", message: explainRollback(error, "Undoing that move") });
            }
          },
        });
      } else {
        toast.show({ tone: "success", message: stage.isWon ? `${target.company} is won and handed to Delivery.` : `${target.company} moved to ${stage.name}.` });
      }
      return null;
    } catch (error) {
      rollback();
      refresh();
      const d = describeError(error);
      const message = d.kind === "validation" || d.kind === "conflict" ? d.body : explainRollback(error, `Moving ${target.company}`);
      return message;
    }
  }

  async function requestMove(target: MoveTarget, stageId: string) {
    const stage = ref?.stages.find((s) => s.id === stageId);
    if (!stage || stage.id === target.stageId) return;
    try {
      const check = (await api.call("postDealsByDealIdMoveCheck", {
        params: { orgSlug, dealId: target.id },
        body: { pipelineStageId: stage.id },
        idempotencyKey: newIdempotencyKey(),
      })) as unknown as MoveCheckResult;
      if (check.needsLostReason) return setDialog({ kind: "lost", target, stage });
      if (check.handoffPrompt && check.allowed) return setDialog({ kind: "handoff", target, stage });
      if (!check.allowed) {
        toast.show({ tone: "danger", message: check.blockers[0]?.message ?? `${target.company} cannot move to ${stage.name} right now.` });
        return;
      }
    } catch (error) {
      toast.show({ tone: "danger", message: explainRollback(error, `Moving ${target.company}`) });
      return;
    }
    const message = await perform(target, stage);
    if (message) toast.show({ tone: "danger", message });
  }

  const host: ReactNode = (
    <>
      {dialog?.kind === "moveTo" && ref ? (
        <MoveToDialog
          stages={ref.stages}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onPick={(stageId) => {
            setDialog(null);
            // After the dialog has closed, so focus returns to the page and the next dialog (reason, handoff) can take it.
            setTimeout(() => void requestMove(dialog.target, stageId), 0);
          }}
        />
      ) : null}
      {dialog?.kind === "lost" && ref ? (
        <LostDialog
          target={dialog.target}
          reasons={ref.lostReasons}
          onClose={() => setDialog(null)}
          onConfirm={async (lostReasonId) => {
            const message = await perform(dialog.target, dialog.stage, { lostReasonId });
            if (!message) setDialog(null);
            return message;
          }}
        />
      ) : null}
      {dialog?.kind === "handoff" && ref ? (
        <HandoffDialog
          target={dialog.target}
          stage={dialog.stage}
          ref_={ref}
          onClose={() => setDialog(null)}
          onConfirm={async (form) => {
            const handoff: Record<string, unknown> = {
              ...(form.ownerId ? { deliveryOwnerMembershipId: form.ownerId } : { ownerLater: true }),
              ...(form.startDate ? { startDate: form.startDate } : {}),
              ...(form.scope.trim() ? { scope: form.scope.trim() } : {}),
              ...(form.template ? {} : { templateOff: true }),
              ...(form.lifecycle ? {} : { lifecycleOff: true }),
            };
            const message = await perform(dialog.target, dialog.stage, { handoff });
            if (!message) setDialog(null);
            return message;
          }}
        />
      ) : null}
    </>
  );

  return { requestMove, openMoveTo: (target: MoveTarget) => setDialog({ kind: "moveTo", target }), host };
}

/* Move to… ---------------------------------------------------------------------------------------------------------------------- */

function MoveToDialog({ stages, target, onClose, onPick }: { stages: Stage[]; target: MoveTarget; onClose: () => void; onPick: (stageId: string) => void }) {
  return (
    <DealModal title={`Move ${target.company} to…`} onClose={onClose} lead="Touch-friendly alternative to dragging.">
      <ul className="fb-dm__stages" aria-label="Stages">
        {stages.map((s) => {
          const current = s.id === target.stageId;
          return (
            <li key={s.id}>
              <button type="button" className="fb-dm__stage" disabled={current} aria-current={current ? "true" : undefined} onClick={() => onPick(s.id)}>
                <span className="fb-dm__dot" style={{ background: stageTone(s) }} aria-hidden="true" />
                <span className="fb-dm__stagename">{s.name}</span>
                <span className="fb-dm__stagenote">{current ? "Current" : s.isWon ? "Opens handoff" : s.isLost ? "Asks for a reason" : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </DealModal>
  );
}

/* Why was it lost? --------------------------------------------------------------------------------------------------------------- */

function LostDialog({ target, reasons, onClose, onConfirm }: { target: MoveTarget; reasons: { id: string; name: string }[]; onClose: () => void; onConfirm: (reasonId: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DealModal
      title={`Why was ${target.company} lost?`}
      onClose={onClose}
      lead="A reason keeps the lost-reasons report honest. Pick one."
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fb-btn fb-dm__btn fb-dm__btn--danger"
            disabled={!reason || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const message = await onConfirm(reason);
              setBusy(false);
              if (message) setError(message);
            }}
          >
            Mark lost
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Lost reason" className="fb-dm__reasons">
        {reasons.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className="fb-dm__reason" data-on={reason === r.id || undefined} onClick={() => setReason(r.id)}>
            {r.name}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="fb-dm__error">
          {error}
        </p>
      ) : null}
    </DealModal>
  );
}

/* Hand off to Delivery ----------------------------------------------------------------------------------------------------------- */

const DEFAULT_TEMPLATE = "Kick-off call with the client · Confirm scope, requirements and access · Set up the service and confirm the go-live date";

function HandoffDialog({
  target,
  stage,
  ref_,
  onClose,
  onConfirm,
}: {
  target: MoveTarget;
  stage: Stage;
  ref_: RefData;
  onClose: () => void;
  onConfirm: (form: HandoffForm) => Promise<string | null>;
}) {
  const { can, orgSlug } = useMember();
  // Everyone is offered with their role beside the name: which roles may own a handoff is the server's rule, not the screen's.
  const delivery = ref_.members;
  const current = ref_.stages.find((s) => s.id === target.stageId);
  const settings = useApiQuery("getHandoffSettings", { params: { orgSlug } }, { enabled: can("organization.manage_settings"), retry: false });
  const tasks = (settings.data as unknown as { tasks?: { title: string }[] } | undefined)?.tasks;
  const [form, setForm] = useState<HandoffForm>({ ownerId: "", startDate: "", scope: "", template: true, lifecycle: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof HandoffForm>(k: K, v: HandoffForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <DealModal
      title={`Hand off ${target.company} to Delivery`}
      onClose={onClose}
      badge={
        <div className="fb-dm__badge">
          <CheckCircle2 size={14} aria-hidden="true" />
          Closed Won
        </div>
      }
      lead={`${[target.title, target.valueLabel].filter(Boolean).join(" · ")}${target.title || target.valueLabel ? ". " : ""}You’re confirming this deal is won. Nothing moves stages on its own.`}
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Not yet, keep in {current?.name ?? "this stage"}
          </button>
          <button
            type="button"
            className="fb-btn fb-btn--primary fb-dm__btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const message = await onConfirm(form);
              setBusy(false);
              if (message) setError(message);
            }}
          >
            <Package size={16} aria-hidden="true" />
            Mark won and hand off
          </button>
        </>
      }
    >
      <div className="fb-dm__grid2">
        <label className="fb-dm__field">
          <span>Delivery owner</span>
          <select className="fb-dm__input" value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
            {delivery.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.userName} · {m.roleName}
              </option>
            ))}
            <option value="">Decide later (Delivery picks an owner)</option>
          </select>
        </label>
        <label className="fb-dm__field">
          <span>Start date</span>
          <input type="date" className="fb-dm__input" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </label>
      </div>
      <label className="fb-dm__field">
        <span>Scope for Delivery</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={2} value={form.scope} onChange={(e) => set("scope", e.target.value)} />
      </label>
      <div className="fb-dm__checks">
        <HandoffCheck on={form.template} onChange={(v) => set("template", v)} label="Apply the onboarding task template" detail={tasks?.length ? tasks.map((t) => t.title).join(" · ") : DEFAULT_TEMPLATE} />
        <HandoffCheck on={form.lifecycle} onChange={(v) => set("lifecycle", v)} label={`Move ${target.company} to Onboarding`} detail="Customer lifecycle moves to Onboarding" />
        <HandoffCheck on disabled onChange={() => undefined} label="Notify Delivery" detail="In-app and email, per each person’s preferences" />
      </div>
      {error ? (
        <p role="alert" className="fb-dm__error">
          {error}
        </p>
      ) : null}
      <span className="fb-sr-only">{stage.name}</span>
    </DealModal>
  );
}

function HandoffCheck({ on, onChange, label, detail, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; detail: ReactNode; disabled?: boolean }) {
  return (
    <label className="fb-dm__check">
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="fb-dm__checklabel">{label}</span>
        <span className="fb-dm__checkdetail">{detail}</span>
      </span>
    </label>
  );
}

