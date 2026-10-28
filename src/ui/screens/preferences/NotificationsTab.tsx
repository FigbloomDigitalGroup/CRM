"use client";

import { Info } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorState, LoadingState, describeError, explainRollback, queryKeyFor, useApiMutation, useMember, useToast } from "@/ui";
import { useNotificationPrefsQuery } from "./hooks";
import type { NotificationPrefsView } from "./model";

const CAP_CHOICES = [10, 20, 50];
const CHANNELS = [
  { key: "inApp", label: "In-app" },
  { key: "email", label: "Email" },
  { key: "push", label: "Push" },
] as const;

type Channel = (typeof CHANNELS)[number]["key"];
type Body = { preset?: string; types?: Record<string, Partial<Record<Channel, boolean>>>; quietHours?: { enabled?: boolean }; dailyEmailCap?: number };

export function NotificationsTab() {
  const { orgSlug } = useMember();
  const { view, isLoading, error, refetch } = useNotificationPrefsQuery();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useApiMutation("updateMyNotificationPreferences");
  const key = queryKeyFor("getMyNotificationPreferences", { params: { orgSlug } });

  if (isLoading) return <LoadingState label="Loading your notification settings" lines={6} />;
  if (error || !view) return <ErrorState error={error} area="Notifications" onRetry={() => void refetch()} />;

  async function send(body: Body, message: string, undoBody?: Body) {
    try {
      const next = (await update.mutateAsync({ params: { orgSlug }, body: body as never })) as unknown as NotificationPrefsView;
      qc.setQueryData(key, next);
      toast.show({
        message,
        undo: undoBody
          ? async () => {
              const back = (await update.mutateAsync({ params: { orgSlug }, body: undoBody as never })) as unknown as NotificationPrefsView;
              qc.setQueryData(key, back);
            }
          : undefined,
      });
    } catch (e) {
      const d = describeError(e);
      toast.show({ tone: "danger", message: d.kind === "validation" ? d.body : explainRollback(e, "That change") });
      void qc.invalidateQueries({ queryKey: key });
    }
  }

  const v = view;
  const capOptions = Array.from(new Set([...CAP_CHOICES.filter((c) => c >= v.dailyEmailCapRange.min && c <= v.dailyEmailCapRange.max), v.dailyEmailCap])).sort((a, b) => a - b);
  const presetLabel = (k: string) => v.presets.find((p) => p.key === k)?.label ?? k;

  function applyPreset(k: string) {
    const was = v.preset === "CUSTOM" ? undefined : { preset: v.preset };
    void send({ preset: k }, `Notifications: ${presetLabel(k)}${k === "OFF" ? " (overdue alerts stay on)" : ""}.`, was);
  }

  return (
    <section className="fb-prefs__card" aria-labelledby="prefs-notif" data-testid="prefs-notifications">
      <div className="fb-prefs__cardhead">
        <h2 id="prefs-notif">How much do you want to hear?</h2>
        <div className="fb-prefs__seg" role="radiogroup" aria-label="Notification preset">
          {v.presets.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={v.preset === p.key} data-on={v.preset === p.key} title={p.description} onClick={() => applyPreset(p.key)}>
              {p.label}
            </button>
          ))}
          {v.preset === "CUSTOM" ? <button type="button" role="radio" aria-checked data-on="true" tabIndex={-1}>Custom</button> : null}
        </div>
      </div>
      <div className="fb-prefs__tablewrap">
        <table className="fb-prefs__table">
          <caption className="fb-sr-only">Which events notify you, and how</caption>
          <thead>
            <tr>
              <th scope="col">EVENT</th>
              {CHANNELS.map((c) => <th key={c.key} scope="col" className="fb-prefs__chan">{c.label.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {v.types.map((t) => (
              <tr key={t.type}>
                <th scope="row">
                  {t.label}
                  {t.alwaysOn ? <span className="fb-prefs__hint fb-prefs__inlinehint"> · always on, so a missed deadline is never hidden</span> : null}
                  <span className="fb-prefs__hint fb-prefs__desc">{t.description}</span>
                </th>
                {CHANNELS.map((c) => {
                  const ch = t.channels[c.key];
                  const unavailable = c.key === "push" && !t.channels.push.available;
                  const locked = c.key !== "push" && (ch as { locked: boolean }).locked;
                  const reason = unavailable ? t.channels.push.note : locked ? "Always on: overdue alerts cannot be turned off." : undefined;
                  return (
                    <td key={c.key} className="fb-prefs__chan">
                      <input
                        type="checkbox"
                        aria-label={`${t.label}: ${c.label}`}
                        checked={ch.enabled}
                        disabled={unavailable || locked}
                        title={reason}
                        aria-describedby={reason ? `why-${t.type}-${c.key}` : undefined}
                        onChange={(e) => void send({ types: { [t.type]: { [c.key]: e.target.checked } } }, `${t.label}: ${c.label} ${e.target.checked ? "on" : "off"}.`, { types: { [t.type]: { [c.key]: ch.enabled } } })}
                      />
                      {reason ? <span id={`why-${t.type}-${c.key}`} className="fb-sr-only">{reason}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fb-prefs__grid fb-prefs__grid--tight">
        <label className="fb-prefs__tile fb-prefs__tile--check">
          <input
            type="checkbox"
            checked={v.quietHours.enabled}
            onChange={(e) => void send({ quietHours: { enabled: e.target.checked } }, `Quiet hours ${e.target.checked ? "on" : "off"}.`, { quietHours: { enabled: v.quietHours.enabled } })}
          />
          <span>
            <span className="fb-prefs__checkl">Quiet hours {v.quietHours.start}–{v.quietHours.end}</span>
            <span className="fb-prefs__hint">Push and email wait until morning. In-app still collects them. ({v.quietHours.timeZone})</span>
          </span>
        </label>
        <label className="fb-prefs__tile">
          <span className="fb-prefs__checkl">Daily email limit</span>
          <select className="fb-input" value={v.dailyEmailCap} aria-label="Daily email limit" onChange={(e) => void send({ dailyEmailCap: Number(e.target.value) }, `Daily email limit: ${e.target.value}.`, { dailyEmailCap: v.dailyEmailCap })}>
            {capOptions.map((c) => <option key={c} value={c}>At most {c} emails a day</option>)}
          </select>
          <span className="fb-prefs__hint">The rest arrive in your next email.{v.heldForDigest > 0 ? ` ${v.heldForDigest} waiting for it now.` : ""}</span>
        </label>
      </div>
      <p className="fb-prefs__foot"><Info size={14} aria-hidden="true" /> Overdue alerts for work assigned to you can’t be fully turned off. Push works once the app is installed on your phone.</p>
    </section>
  );
}
