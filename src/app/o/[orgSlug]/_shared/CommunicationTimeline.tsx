"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Channel = "EMAIL" | "PHONE" | "WHATSAPP" | "SMS" | "MEETING" | "SOCIAL" | "OTHER";
type Direction = "INBOUND" | "OUTBOUND";

const CHANNELS: Channel[] = ["EMAIL", "PHONE", "WHATSAPP", "SMS", "MEETING", "SOCIAL", "OTHER"];

interface Communication {
  id: string;
  channel: Channel;
  direction: Direction;
  subject: string | null;
  summary: string;
  occurredAt: string;
  authorMembershipId: string | null;
}

interface Member {
  membershipId: string;
  userName: string;
}

/**
 * Single reusable timeline component for Communication records (FIG-598),
 * modeled directly on `ActivityTimeline.tsx`. Two separate create actions,
 * not one form with a mode switch: "Send email" actually delivers mail
 * (`POST .../communications/send-email`) and logs it as a side effect;
 * "Log a communication" never sends anything, it only records that one
 * happened (a phone call, a meeting, an email sent from outside the CRM).
 * Conflating them would make a plain log entry look like it triggered a
 * real send, or vice versa.
 */
export function CommunicationTimeline({
  orgSlug,
  parentField,
  parentId,
  communications,
  members,
  canCreate,
  defaultToEmail,
}: {
  orgSlug: string;
  parentField: "companyId" | "contactId" | "leadId" | "dealId";
  parentId: string;
  communications: Communication[];
  members: Member[];
  canCreate: boolean;
  defaultToEmail?: string | null;
}) {
  const router = useRouter();

  const [to, setTo] = useState(defaultToEmail ?? "");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [channel, setChannel] = useState<Channel>("PHONE");
  const [direction, setDirection] = useState<Direction>("OUTBOUND");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [logError, setLogError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  const authorName = (membershipId: string | null) =>
    membershipId ? (members.find((m) => m.membershipId === membershipId)?.userName ?? "--") : "(inbound)";

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/communications/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [parentField]: parentId,
          to,
          subject: emailSubject,
          body: emailBody,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send email.");
      setEmailSubject("");
      setEmailBody("");
      router.refresh();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send email.");
    } finally {
      setSending(false);
    }
  }

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    setLogging(true);
    setLogError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [parentField]: parentId,
          channel,
          direction,
          subject: subject || undefined,
          summary,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log communication.");
      setSubject("");
      setSummary("");
      router.refresh();
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Failed to log communication.");
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="card">
      <strong>Communications</strong>
      {communications.length === 0 && <p className="who">No communications logged yet.</p>}
      <ul className="timeline">
        {communications.map((c) => (
          <li key={c.id}>
            <span className="badge">{c.channel}</span>{" "}
            <span className="badge">{c.direction}</span>{" "}
            <span className="who">
              {new Date(c.occurredAt).toLocaleString()} &middot; {authorName(c.authorMembershipId)}
            </span>
            {c.subject && <div>{c.subject}</div>}
            <div>{c.summary}</div>
          </li>
        ))}
      </ul>

      {canCreate && (
        <>
          <h3>Send email</h3>
          <form className="stack" onSubmit={handleSend}>
            <label>
              To
              <input type="email" required value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label>
              Subject
              <input required value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </label>
            <label>
              Message
              <textarea required value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            </label>
            {sendError && <p className="error">{sendError}</p>}
            <button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send and log"}
            </button>
          </form>

          <h3>Log a communication</h3>
          <p className="who">For a call, meeting, or anything that didn&apos;t happen through this form.</p>
          <form className="stack" onSubmit={handleLog}>
            <label>
              Channel
              <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                <option value="OUTBOUND">Outbound</option>
                <option value="INBOUND">Inbound</option>
              </select>
            </label>
            <label>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label>
              Summary
              <textarea required value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
            {logError && <p className="error">{logError}</p>}
            <button type="submit" disabled={logging}>
              {logging ? "Logging..." : "Log communication"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
