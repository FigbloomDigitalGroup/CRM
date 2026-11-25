"use client";

import Link from "next/link";
import { Copy, Lock, Mail, MessageCircle, Pencil } from "lucide-react";
import { useState } from "react";
import { Button, Drawer, useMember, useToast } from "@/ui";
import { dateLabel, describeError, kes, useQuoteActivity, useRevokeShare, useSendQuote, whenLabel } from "./api";
import type { QuoteRow } from "./api";
import { QuoteStatusPill } from "./QuoteBuilder";
import { shareBlockedReason, whatsappUrl } from "./quoteListModel";

const EVENT_LABEL: Record<string, string> = {
  SENT: "Sent with a secure link",
  VIEWED: "Opened by the client",
  LINK_REVOKED: "Link revoked",
  LINK_EXPIRED_VISIT: "Someone opened a link that had expired",
};

/**
 * The quote drawer on the Quotes page (design QI3): who and what it is, its events (sent, viewed, revoked, expired), and the Share panel: email,
 * copy link and WhatsApp (UC-R4, FIG-1777). Copy link and WhatsApp make the same secure link an email carries, without sending one
 * (`channel: "link"`); every link keeps the hashed token, the expiry and the revoke. Sending through a connected mailbox is still open.
 */
export function QuoteDrawer({ row, onClose }: { row: QuoteRow; onClose: () => void }) {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const v = row.latest;
  const mayShare = can("quotes.create");
  const blocked = shareBlockedReason({ status: v.status, expired: v.expired, amountMasked: v.amountMasked, mayShare });
  const activity = useQuoteActivity(orgSlug, row.id, v.version);
  const send = useSendQuote();
  const revoke = useRevokeShare();
  const [to, setTo] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const params = { orgSlug, quoteId: row.id, version: String(v.version) };

  const fail = (e: unknown) => toast.show({ tone: "danger", message: describeError(e).body });

  const sendEmail = async () => {
    try {
      await send.mutateAsync({ params, body: to.trim() ? { to: to.trim() } : {} });
      toast.show({ tone: "success", message: `Quote ${row.number} emailed${to.trim() ? ` to ${to.trim()}` : " to the deal's primary contact"}.` });
    } catch (e) {
      fail(e);
    }
  };

  /** The link is made once per drawer visit and reused, so Copy link then WhatsApp does not make two links. */
  const makeLink = async (): Promise<string | null> => {
    if (link) return link;
    try {
      const r = await send.mutateAsync({ params, body: { channel: "link" } });
      setLink(r.link);
      return r.link;
    } catch (e) {
      fail(e);
      return null;
    }
  };

  const copyLink = async () => {
    const url = await makeLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ tone: "success", message: "Link copied. It marks the quote as sent." });
    } catch {
      toast.show({ message: "Copy the link from the box below." });
    }
  };

  const whatsapp = async () => {
    const url = await makeLink();
    if (url) window.open(whatsappUrl(row.number, url), "_blank", "noopener,noreferrer");
  };

  const events = activity.data?.events ?? [];
  const shares = activity.data?.shares ?? [];

  return (
    <Drawer open onClose={onClose} title={`${row.number} · v${v.version}`}>
      <div className="fb-com-drawer" data-testid="quote-drawer">
        <div className="fb-com-actions">
          <QuoteStatusPill status={v.status} />
          {v.expired ? <span className="fb-com-pill fb-com-pill--warn">Expired</span> : null}
          <span className="fb-com-muted">{row.companyName}</span>
        </div>
        <dl className="fb-com-sum">
          <div><dt>Valid until</dt><dd>{dateLabel(v.validUntil)}</dd></div>
          <div><dt>Total</dt><dd>{v.amountMasked ? "Hidden" : kes(v.total, row.currency)}</dd></div>
        </dl>
        {v.amountMasked ? <p className="fb-com-note"><Lock size={13} aria-hidden="true" /> Amounts are hidden for your role.</p> : null}
        <div className="fb-com-actions">
          <Link className="fb-btn fb-btn--secondary" href={`/o/${orgSlug}/quotes/${row.dealId}`}>
            <Pencil size={15} aria-hidden="true" /> {mayShare && !v.locked ? "Open in quote builder" : "Open quote"}
          </Link>
        </div>

        <section className="fb-com-card" aria-label="Share">
          <h3 className="fb-com__h3">Share</h3>
          {blocked ? (
            <p role="note" className="fb-com-lock"><Lock size={14} aria-hidden="true" /> {blocked}</p>
          ) : (
            <>
              <label className="fb-com-field">
                <span>Email to</span>
                <input className="fb-input" type="email" value={to} placeholder="Leave empty to use the deal's primary contact" onChange={(e) => setTo(e.target.value)} />
              </label>
              <div className="fb-com-sharerow">
                <Button variant="primary" disabled={send.isPending} onClick={() => void sendEmail()}>
                  <Mail size={15} aria-hidden="true" /> Send email
                </Button>
                <Button disabled={send.isPending} onClick={() => void copyLink()}>
                  <Copy size={15} aria-hidden="true" /> Copy link
                </Button>
                <Button disabled={send.isPending} onClick={() => void whatsapp()}>
                  <MessageCircle size={15} aria-hidden="true" /> WhatsApp
                </Button>
              </div>
              {link ? <input className="fb-input" readOnly aria-label="Share link" value={link} onFocus={(e) => e.currentTarget.select()} /> : null}
              <p className="fb-com-muted">The link opens a read-only copy. It stops working when the quote expires or when you revoke it. Copy link and WhatsApp mark the quote as sent. Sending through your own connected mailbox is not available yet.</p>
            </>
          )}
        </section>

        <section className="fb-com-card" aria-label="Activity">
          <h3 className="fb-com__h3">Links and activity</h3>
          {activity.isLoading ? <p className="fb-com-empty">Loading</p> : null}
          {!activity.isLoading && shares.length === 0 && events.length === 0 ? <p className="fb-com-empty">Not shared yet.</p> : null}
          {shares.length > 0 ? (
            <ul className="fb-com-history">
              {shares.map((s) => (
                <li key={s.id}>
                  <span>
                    Link made {s.createdAt ? whenLabel(s.createdAt) : ""} ·{" "}
                    {s.revokedAt ? "revoked" : s.active ? `works until ${dateLabel(s.expiresAt)}` : "expired"}
                  </span>
                  {s.active && mayShare ? (
                    <button type="button" className="fb-com-linkbtn" disabled={revoke.isPending} onClick={() => void revoke.mutateAsync({ params: { orgSlug, quoteId: row.id, shareId: s.id } }).then(() => toast.show({ message: "Link revoked." }), fail)}>
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {events.length > 0 ? (
            <ul className="fb-com-history">
              {[...events].reverse().map((e) => (
                <li key={e.id}><span className="fb-com-muted">{whenLabel(e.occurredAt)}</span> <span>{EVENT_LABEL[e.type] ?? e.type}</span></li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}
