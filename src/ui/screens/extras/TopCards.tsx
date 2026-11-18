"use client";

import { useState } from "react";
import { useToast } from "../../components/toast";
import { describeError } from "../../errors";
import { Icon } from "../leads/icons";
import { TEMPERATURE_LABEL, tempTone, type Temperature } from "../leads/format";
import { useExtras, useRecordRead } from "./hooks";
import type { ExtrasKind } from "./RecordExtras";

interface ScoreView {
  score: number;
  band: string;
  factors: { key: string; label: string; points: number }[];
  computedAt: string | null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Lead score (X1): the number, the band in words, and why, so a score is never a bare number. */
export function ScoreCard({ id }: { id: string }) {
  const { params } = useExtras("lead", id);
  const q = useRecordRead<ScoreView>("getLeadsByLeadIdScore", params);
  if (!q.data) return null;
  const s = q.data;
  const [bg, fg] = tempTone(s.band);
  const word = TEMPERATURE_LABEL[s.band as Temperature] ?? s.band;
  return (
    <section className="fb-xcard" aria-label="Lead score">
      <div className="fb-xcard__head">
        <span className="fb-xscore" style={{ background: bg, color: fg }}>
          <span className="fb-xscore__n" style={{ background: fg }}>{s.score}</span>
          {word}
        </span>
        <strong className="fb-xcard__title">Lead score</strong>
      </div>
      <div className="fb-xreasons">
        {s.factors.map((f) => (
          <span key={f.key} className="fb-xreason">
            {f.label}
            {f.points ? <span className="fb-xreason__d" style={{ color: f.points > 0 ? "var(--primary-text)" : "var(--red)" }}>{signed(f.points)}</span> : null}
          </span>
        ))}
        {s.factors.length === 0 ? <span className="fb-xreason">No factors yet</span> : null}
      </div>
    </section>
  );
}

const HEALTH_WORD: Record<string, string> = { GOOD: "Good", WATCH: "Needs attention", AT_RISK: "At risk" };
const HEALTH_DOT: Record<string, string> = { GOOD: "var(--primary)", WATCH: "var(--orange)", AT_RISK: "var(--red)" };

/** Customer health (companies): the band and the factors behind it. The API already hides factors this role may not see (payments). */
export function HealthCard({ id }: { id: string }) {
  const { params } = useExtras("company", id);
  const q = useRecordRead<ScoreView>("getCompaniesByCompanyIdHealth", params);
  if (!q.data) return null;
  const h = q.data;
  return (
    <section className="fb-xcard" aria-label="Customer health">
      <div className="fb-xcard__head">
        <span className="fb-xdot" style={{ background: HEALTH_DOT[h.band] ?? "var(--text-3)" }} aria-hidden="true" />
        <strong className="fb-xcard__title">Customer health: {HEALTH_WORD[h.band] ?? h.band}</strong>
        <span className="fb-xhealth__n">{h.score}/100</span>
      </div>
      <div className="fb-xparts">
        {h.factors.map((f) => (
          <div key={f.key} className="fb-xpart">
            <span>{f.label}</span>
            <strong style={{ color: f.points > 0 ? "var(--primary-text)" : f.points < 0 ? "var(--red)" : "var(--text)" }}>{signed(f.points)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Follow or unfollow: followers are told about new comments. Whether you follow comes with the comments read. */
export function FollowCard({ kind, id, archived }: { kind: ExtrasKind; id: string; archived: boolean }) {
  const { ops, params, call, refresh } = useExtras(kind, id);
  const toast = useToast();
  const q = useRecordRead<{ following: boolean }>(ops.comments, params);
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const on = Boolean(q.data.following);
  async function toggle() {
    setBusy(true);
    try {
      await call(on ? ops.unfollow : ops.follow);
      await refresh(ops.comments);
      toast.show({ message: on ? `You stopped following this ${ops.noun}.` : "You’ll be notified of new comments." });
    } catch (error) {
      toast.show({ tone: "danger", message: `That did not go through. ${describeError(error).body}` });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fb-xcard fb-xcard--follow" aria-label="Follow this record">
      <strong className="fb-xcard__title">Follow this record</strong>
      <p className="fb-xcard__text">Get notified of new comments even if you don’t own it.</p>
      <button type="button" className="fb-xfollow" data-on={on ? "true" : undefined} aria-pressed={on} disabled={busy || archived} onClick={toggle}>
        <Icon name={on ? "check" : "bell"} size={14} />
        {on ? "Following" : "Follow"}
      </button>
    </section>
  );
}
