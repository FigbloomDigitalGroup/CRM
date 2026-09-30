"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ActivityType = "CALL" | "MEETING" | "NOTE" | "EMAIL" | "WHATSAPP" | "OTHER";

const TYPES: ActivityType[] = ["CALL", "MEETING", "NOTE", "EMAIL", "WHATSAPP", "OTHER"];

interface Activity {
  id: string;
  type: ActivityType;
  subject: string | null;
  description: string | null;
  outcome: string | null;
  occurredAt: string;
  authorMembershipId: string;
}

interface Member {
  membershipId: string;
  userName: string;
}

/**
 * Single reusable timeline component: Company, Deal, and Lead detail pages
 * all render this against their own parent id (FIG-441) to log calls,
 * meetings, emails, WhatsApp summaries, and notes chronologically.
 */
export function ActivityTimeline({
  orgSlug,
  parentField,
  parentId,
  activities,
  members,
  canCreate,
}: {
  orgSlug: string;
  parentField: "companyId" | "contactId" | "leadId" | "dealId";
  parentId: string;
  activities: Activity[];
  members: Member[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<ActivityType>("NOTE");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const authorName = (membershipId: string) =>
    members.find((m) => m.membershipId === membershipId)?.userName ?? "--";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [parentField]: parentId,
          type,
          subject: subject || undefined,
          description: description || undefined,
          outcome: outcome || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to log activity.");
      setSubject("");
      setDescription("");
      setOutcome("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log activity.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <strong>Activity timeline</strong>
      {activities.length === 0 && <p className="who">No activity logged yet.</p>}
      <ul className="timeline">
        {activities.map((a) => (
          <li key={a.id}>
            <span className="badge">{a.type}</span>{" "}
            <span className="who">
              {new Date(a.occurredAt).toLocaleString()} &middot;{" "}
              {authorName(a.authorMembershipId)}
            </span>
            {a.subject && <div>{a.subject}</div>}
            {a.description && <div>{a.description}</div>}
            {a.outcome && <div className="who">Outcome: {a.outcome}</div>}
          </li>
        ))}
      </ul>

      {canCreate && (
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Outcome
            <input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Logging..." : "Log activity"}
          </button>
        </form>
      )}
    </div>
  );
}
