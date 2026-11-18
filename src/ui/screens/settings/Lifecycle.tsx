"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "../..";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, Switch, asArray, useReport } from "./kit";

interface Reminders {
  proposalFollowUp: { enabled: boolean; days: number };
  renewal?: { enabled: boolean; daysAhead: number };
  dormant?: { enabled: boolean };
  overdueInvoices?: { enabled: boolean };
}

/**
 * Customer lifecycle (S1, FIG-1106): when a renewal counts as due soon and how long it may be late before it lapses, and which reminders the system
 * creates for the people who own the work. Reminders only remind: they create tasks and notices, they never move a customer or a deal (B3.x).
 */
export function LifecycleSettings() {
  const { orgSlug } = useMember();
  const renewal = useApiQuery("getRenewalSettings", { params: { orgSlug } });
  const reminders = useApiQuery("getReminderSettings", { params: { orgSlug } });
  return (
    <>
      <Gate q={renewal} area="The renewal settings" lines={2}>{renewal.data ? <RenewalForm initial={renewal.data} /> : null}</Gate>
      <Gate q={reminders} area="The reminder settings" lines={3}>{reminders.data ? <ReminderForm initial={reminders.data as unknown as Reminders} /> : null}</Gate>
    </>
  );
}

function RenewalForm({ initial }: { initial: { dueSoonDays: number; graceDays: number } }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const [form, setForm] = useState({ dueSoonDays: String(initial.dueSoonDays), graceDays: String(initial.graceDays) });
  const save = useApiMutation("updateRenewalSettings", {
    invalidate: [["getRenewalSettings", { orgSlug }, null]],
    onSuccess: () => report.ok("Renewal settings saved."),
    onError: (e) => report.fail(e, "The renewal settings did not save"),
  });
  return (
    <Panel title="Renewals" description="Recurring services are due soon this many days before they renew, and lapse after the grace period if nobody renews them.">
      <form
        className="fb-set-inline"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ params: { orgSlug }, body: { dueSoonDays: Number(form.dueSoonDays), graceDays: Number(form.graceDays) } });
        }}
      >
        <Input label="Due soon (days before renewal)" type="number" min={1} value={form.dueSoonDays} onChange={(e) => setForm({ ...form, dueSoonDays: e.target.value })} />
        <Input label="Grace period (days after renewal)" type="number" min={0} value={form.graceDays} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} />
        <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
      </form>
    </Panel>
  );
}

function ReminderForm({ initial }: { initial: Reminders }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const qc = useQueryClient();
  const [days, setDays] = useState(String(initial.proposalFollowUp.days));
  useEffect(() => setDays(String(initial.proposalFollowUp.days)), [initial.proposalFollowUp.days]);
  const save = useApiMutation("updateReminderSettings", {
    onSuccess: () => {
      report.ok("Reminder settings saved.");
      void qc.invalidateQueries({ queryKey: ["getReminderSettings", { orgSlug }, null] });
    },
    onError: (e) => report.fail(e, "The reminder settings did not save"),
  });
  const send = (body: object) => save.mutate({ params: { orgSlug }, body: body as never });
  const rows: { label: string; desc: string; on: boolean; toggle: (v: boolean) => void; extra?: React.ReactNode }[] = [
    {
      label: "Chase unanswered proposals",
      desc: "Creates a “Chase proposal” task for the deal owner.",
      on: initial.proposalFollowUp.enabled,
      toggle: (enabled) => send({ proposalFollowUp: { enabled } }),
      extra: (
        <span className="fb-set-inline" style={{ alignItems: "center" }}>
          <Input label="After (days)" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} onBlur={() => Number(days) !== initial.proposalFollowUp.days && send({ proposalFollowUp: { days: Number(days) } })} />
        </span>
      ),
    },
    ...(initial.renewal ? [{ label: "Remind about renewals", desc: "Creates a renewal task for the customer owner before a service renews.", on: initial.renewal.enabled, toggle: (enabled: boolean) => send({ renewal: { enabled } }) }] : []),
    ...(initial.dormant ? [{ label: "Spot customers going quiet", desc: "Suggests a check-in for a customer nobody has contacted for a while.", on: initial.dormant.enabled, toggle: (enabled: boolean) => send({ dormant: { enabled } }) }] : []),
    ...(initial.overdueInvoices ? [{ label: "Overdue invoice notices", desc: "Notifies Finance when an invoice passes its due date.", on: initial.overdueInvoices.enabled, toggle: (enabled: boolean) => send({ overdueInvoices: { enabled } }) }] : []),
  ];
  return (
    <Panel flush title="Reminders" description="These create tasks and notices for people. They never move a customer between lifecycle states or change a deal.">
      {rows.map((r) => (
        <div key={r.label} className="fb-set-row">
          <div className="fb-set-row__main">
            <div className="fb-set-row__name">{r.label}</div>
            <div className="fb-set-row__desc">{r.desc}</div>
          </div>
          {r.on ? r.extra : null}
          <Switch label={r.label} checked={r.on} onChange={r.toggle} />
        </div>
      ))}
    </Panel>
  );
}

interface HandoffTask {
  title: string;
  dueInDays: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | string;
  description?: string;
}

/** Onboarding task template (S1, FIG-1106): the tasks offered in the handoff dialog when a deal is won. The person handing off can switch it off. */
export function OnboardingTemplate() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getHandoffSettings", { params: { orgSlug } });
  const ref = useApiQuery("getReferenceData", { params: { orgSlug } });
  return (
    <Gate q={q} area="The onboarding template">
      {q.data ? <TemplateForm initial={q.data as unknown as { tasks: HandoffTask[]; customerLifecycleStateId?: string | null; managementCanMarkDelivered: boolean }} states={asArray<{ id: string; name: string; isActive: boolean }>(ref.data?.lifecycleStates)} /> : null}
    </Gate>
  );
}

function TemplateForm({ initial, states }: { initial: { tasks: HandoffTask[]; customerLifecycleStateId?: string | null; managementCanMarkDelivered: boolean }; states: { id: string; name: string; isActive: boolean }[] }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const [tasks, setTasks] = useState<HandoffTask[]>(initial.tasks);
  const [state, setState] = useState(initial.customerLifecycleStateId ?? "");
  const [mgmt, setMgmt] = useState(initial.managementCanMarkDelivered);
  const save = useApiMutation("putHandoffSettings", {
    invalidate: [["getHandoffSettings", { orgSlug }, null]],
    onSuccess: () => report.ok("Onboarding template saved."),
    onError: (e) => report.fail(e, "The template did not save"),
  });
  const edit = (i: number, patch: Partial<HandoffTask>) => setTasks((t) => t.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <Panel title="Onboarding task template" description="Offered in the handoff dialog when a deal is won. The person handing off can switch it off.">
      {tasks.map((t, i) => (
        <div key={i} className="fb-set-inline" style={{ borderTop: i ? "1px solid var(--border)" : 0, paddingTop: i ? 12 : 0 }}>
          <Input label={`Task ${i + 1}`} value={t.title} onChange={(e) => edit(i, { title: e.target.value })} />
          <Input label="Due (days after won)" type="number" min={0} value={String(t.dueInDays)} onChange={(e) => edit(i, { dueInDays: Number(e.target.value) })} style={{ maxWidth: 140 }} />
          <Select label="Priority" value={t.priority} onChange={(e) => edit(i, { priority: e.target.value })} options={[{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }]} />
          <Button variant="ghost" aria-label={`Remove task ${i + 1}`} onClick={() => setTasks((all) => all.filter((_, k) => k !== i))}>Remove</Button>
        </div>
      ))}
      <div><Button onClick={() => setTasks((t) => [...t, { title: "", dueInDays: 1, priority: "MEDIUM" }])}>Add a task</Button></div>
      <div style={{ maxWidth: 360 }}>
        <Select label="Customer lifecycle after handoff" value={state} onChange={(e) => setState(e.target.value)} placeholder="Leave unchanged" options={states.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} />
      </div>
      <label className="fb-check"><input type="checkbox" checked={mgmt} onChange={(e) => setMgmt(e.target.checked)} /><span>Management can mark a handoff delivered</span></label>
      <div>
        <Button variant="primary" loading={save.isPending} disabledReason={tasks.every((t) => t.title.trim()) ? undefined : "Every task needs a title."} onClick={() => save.mutate({ params: { orgSlug }, body: { tasks: tasks.map((t) => ({ title: t.title.trim(), dueInDays: t.dueInDays, priority: t.priority as "LOW" | "MEDIUM" | "HIGH", ...(t.description ? { description: t.description } : {}) })), customerLifecycleStateId: state || null, managementCanMarkDelivered: mgmt } })}>Save template</Button>
      </div>
    </Panel>
  );
}
