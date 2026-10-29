"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, describeError, queryKeyFor, useApiMutation, useMember, useToast } from "@/ui";
import { useSessionsQuery, useSignInEventsQuery } from "./hooks";
import { OUTCOME_LABEL, deviceIcon, type SessionRow } from "./model";

/** "Today 11:23", "18 Oct 08:02": written in the person's own time zone and clock. */
export function whenLabel(iso: string, opts: { timeZone: string | null; hour12: boolean; now?: Date }): string {
  const d = new Date(iso);
  const now = opts.now ?? new Date();
  const zone = opts.timeZone ?? undefined;
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: zone });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: opts.hour12, timeZone: zone });
  if (day(d) === day(now)) return `Today ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: zone });
  return `${date} ${time}`;
}

export function SecurityTab() {
  const member = useMember();
  const toast = useToast();
  const qc = useQueryClient();
  const sessionsQ = useSessionsQuery();
  const eventsQ = useSignInEventsQuery();
  const revoke = useApiMutation("revokeMySession");
  const signOutOthers = useApiMutation("signOutOtherSessions");
  const [confirmAll, setConfirmAll] = useState(false);
  const fmt = (iso: string) => whenLabel(iso, { timeZone: member.timeZone, hour12: member.hour12 });
  const sessionsKey = queryKeyFor("listMySessions");

  async function endOne(s: SessionRow) {
    try {
      await revoke.mutateAsync({ params: { sessionId: s.id } } as never);
      await qc.invalidateQueries({ queryKey: sessionsKey });
      toast.show({ message: `${s.deviceLabel ?? "That device"} signed out.` });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    }
  }

  async function endOthers() {
    await signOutOthers.mutateAsync({} as never);
    await qc.invalidateQueries({ queryKey: sessionsKey });
    setConfirmAll(false);
    toast.show({ message: "Signed out of your other devices. They are signed out now." });
  }

  const others = sessionsQ.sessions.filter((s) => !s.current);

  return (
    <div className="fb-prefs__grid fb-prefs__grid--wide" data-testid="prefs-security">
      <section className="fb-prefs__card" aria-labelledby="prefs-pw">
        <h2 id="prefs-pw">Change password</h2>
        <p className="fb-prefs__hint">For your security, passwords are changed from the email link, the same way as when you forget one. We send the link to your sign-in email. Other devices stay signed in until you sign them out below.</p>
        <a className="fb-btn fb-btn--primary fb-prefs__linkbtn" href="/forgot-password">Change password by email</a>
      </section>

      <section className="fb-prefs__card" aria-labelledby="prefs-2fa">
        <div className="fb-prefs__cardhead"><h2 id="prefs-2fa">Two-step sign-in</h2><Badge tone="info">V1.1</Badge></div>
        <p className="fb-prefs__hint">Arrives in V1.1. It adds a code from an authenticator app after your password, and will be required for Management and Finance.</p>
      </section>

      <section className="fb-prefs__card fb-prefs__card--flush fb-prefs__span" aria-labelledby="prefs-sessions">
        <div className="fb-prefs__listhead">
          <h2 id="prefs-sessions">My sessions</h2>
          <Button variant="danger" size="sm" disabledReason={sessionsQ.isLoading ? "Loading your sessions." : others.length === 0 ? "You are signed in on this device only." : undefined} onClick={() => setConfirmAll(true)}>Sign out other devices</Button>
        </div>
        {sessionsQ.isLoading ? <LoadingState label="Loading your sessions" lines={2} /> : sessionsQ.error ? <ErrorState error={sessionsQ.error} area="Your sessions" onRetry={() => void sessionsQ.refetch()} /> : (
          <ul className="fb-prefs__list" data-testid="session-list">
            {sessionsQ.sessions.map((s) => {
              const Icon = deviceIcon(s.deviceLabel) === "phone" ? Smartphone : Monitor;
              return (
                <li key={s.id} className="fb-prefs__listrow" data-current={s.current}>
                  <Icon size={17} aria-hidden="true" />
                  <div className="fb-prefs__grow">
                    <div className="fb-prefs__strong">
                      {s.deviceLabel ?? "Unknown device"} {s.current ? <span className="fb-prefs__selected">This device</span> : null}
                    </div>
                    <div className="fb-prefs__hint">
                      {s.place ?? "Unknown place"} · {s.current ? `signed in ${fmt(s.signedInAt)}` : `last active ${fmt(s.lastActiveAt)}`}
                    </div>
                  </div>
                  {!s.current ? <Button variant="ghost" size="sm" aria-label={`Sign out ${s.deviceLabel ?? "this device"}`} onClick={() => void endOne(s)}>Sign out</Button> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="fb-prefs__card fb-prefs__card--flush fb-prefs__span" aria-labelledby="prefs-history">
        <div className="fb-prefs__listhead"><h2 id="prefs-history">My sign-in history</h2></div>
        {eventsQ.isLoading ? <LoadingState label="Loading your sign-in history" lines={3} /> : eventsQ.error ? <ErrorState error={eventsQ.error} area="Your sign-in history" onRetry={() => void eventsQ.refetch()} /> : eventsQ.events.length === 0 ? (
          <EmptyState title="No sign-ins yet" body="Your recent sign-ins and failed attempts appear here." />
        ) : (
          <ul className="fb-prefs__list" data-testid="signin-history">
            {eventsQ.events.map((e) => {
              const o = OUTCOME_LABEL[e.outcome];
              return (
                <li key={e.id} className="fb-prefs__listrow fb-prefs__history">
                  <span className="fb-prefs__when">{fmt(e.createdAt)}</span>
                  <span className="fb-prefs__grow">{e.deviceLabel ?? "Unknown device"}{e.place ? ` · ${e.place}` : ""}</span>
                  <span className="fb-prefs__outcome" data-tone={o.tone}>{o.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Sign out your other devices?"
        body={`${others.length} other ${others.length === 1 ? "device is" : "devices are"} signed in. They are signed out at once and need your password to come back. This device stays signed in.`}
        confirmLabel="Sign out other devices"
        tone="danger"
        onConfirm={endOthers}
      />
    </div>
  );
}
