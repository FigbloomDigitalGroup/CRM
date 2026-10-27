"use client";

import { Archive, FileX, Lock, WifiOff, TriangleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { copy } from "../copy";
import { describeError, type Denial } from "../errors";
import { Banner, Skeleton } from "./basics";
import { Tooltip } from "./overlays";

/**
 * The seven states every screen handles the same way (F1.05): loading, empty, error, no access, masked value, archived, offline.
 * Wording comes from `src/ui/copy.ts`; nothing here ever prints a raw error message.
 */

/* 1. Loading ------------------------------------------------------------------------------------------------------------------- */

export function LoadingState({ label = copy.loading.label, lines = 4 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="fb-sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

/* 2. Empty --------------------------------------------------------------------------------------------------------------------- */

export function EmptyState({ icon, title = copy.empty.title, body = copy.empty.body, action }: { icon?: ReactNode; title?: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="fb-empty">
      <span className="fb-empty__icon" aria-hidden="true">{icon ?? <Inbox size={20} />}</span>
      <h3 className="fb-empty__title">{title}</h3>
      <p className="fb-empty__body">{body}</p>
      {action}
    </div>
  );
}

/* 4. No access (declared before error, which uses it) -------------------------------------------------------------------------- */

export function NoAccess({ area, denial }: { area: string; denial?: Denial | null }) {
  const owners = denial?.ownerRoles ?? [];
  const ask = denial?.whoToAsk ?? [];
  return (
    <div className="fb-noaccess" role="region" aria-label={copy.noAccess.title(area)}>
      <span aria-hidden="true" style={{ paddingTop: 2 }}><Lock size={18} /></span>
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>{copy.noAccess.title(area)}</h3>
        <p style={{ margin: "6px 0 0", color: "var(--text-2)" }}>{copy.noAccess.body}</p>
        <dl>
          {denial?.yourRole ? (
            <>
              <dt>{copy.noAccess.yourRole}</dt>
              <dd>{denial.yourRole}</dd>
            </>
          ) : null}
          {owners.length ? (
            <>
              <dt>{copy.noAccess.owners}</dt>
              <dd>{owners.join(", ")}</dd>
            </>
          ) : null}
          <dt>{copy.noAccess.askWho}</dt>
          <dd>{ask.length ? ask.join(", ") : copy.noAccess.fallbackAsk}</dd>
        </dl>
      </div>
    </div>
  );
}

/* 3. Error --------------------------------------------------------------------------------------------------------------------- */

/** An error for a whole page or panel, with retry and the reference. A 403 becomes the explained no-access state, a 401 asks to sign in. */
export function ErrorState({ error, area = "This page", onRetry, signInHref = "/login" }: { error: unknown; area?: string; onRetry?: () => void; signInHref?: string }) {
  const d = describeError(error);
  if (d.kind === "noAccess") return <NoAccess area={area} denial={d.denial} />;
  return (
    <div className="fb-empty" role="alert">
      <span className="fb-empty__icon" aria-hidden="true">
        {d.kind === "offline" ? <WifiOff size={20} /> : d.kind === "notFound" ? <FileX size={20} /> : <TriangleAlert size={20} />}
      </span>
      <h3 className="fb-empty__title">{d.title}</h3>
      <p className="fb-empty__body">{d.body}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {d.kind === "signedOut" ? (
          <a className="fb-btn fb-btn--primary" href={signInHref}>{copy.error.signedOut.action}</a>
        ) : d.retryable && onRetry ? (
          <button type="button" className="fb-btn fb-btn--secondary" onClick={onRetry}>{copy.error.retry}</button>
        ) : null}
        {d.reference ? <span className="fb-ref">{copy.error.reference(d.reference)}</span> : null}
      </div>
    </div>
  );
}

/* 5. Masked value -------------------------------------------------------------------------------------------------------------- */

/**
 * Where a value exists but this role may not see it (a deal value, a payment). The value itself is never in the markup. The reason is
 * available to a screen reader and on hover or focus, so the gap is explained rather than silent.
 */
export function MaskedValue({ reason = copy.masked.reason }: { reason?: string }) {
  return (
    <Tooltip text={reason}>
      <span className="fb-masked" tabIndex={0} role="note" aria-label={`${copy.masked.shown}. ${reason}`}>
        <span aria-hidden="true">••••</span>
      </span>
    </Tooltip>
  );
}

/* 6. Archived ------------------------------------------------------------------------------------------------------------------ */

export function ArchivedBanner({ what = "record", onRestore, restoreDisabledReason }: { what?: string; onRestore?: () => void; restoreDisabledReason?: string }) {
  return (
    <Banner
      tone="neutral"
      icon={<Archive size={16} />}
      title={copy.archived.title}
      action={
        onRestore ? (
          <button type="button" className="fb-btn fb-btn--secondary fb-btn--sm" aria-disabled={restoreDisabledReason ? true : undefined} title={restoreDisabledReason} onClick={restoreDisabledReason ? undefined : onRestore}>
            {copy.archived.restore}
          </button>
        ) : undefined
      }
    >
      This {what} is read-only. {restoreDisabledReason ? restoreDisabledReason : "Restore it to make changes."}
    </Banner>
  );
}

/* 7. Offline ------------------------------------------------------------------------------------------------------------------- */

export function OfflineBanner({ queued = 0 }: { queued?: number }) {
  return (
    <Banner tone="warning" icon={<WifiOff size={16} />} role="status">
      <strong>{copy.offline.banner}</strong>
      {queued > 0 ? ` ${queued} change${queued === 1 ? "" : "s"} waiting to be sent.` : null}
    </Banner>
  );
}
