interface Member {
  membershipId: string;
  userName: string;
}

interface AuditEvent {
  id: string;
  action: string;
  actorMembershipId: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: string | Date;
}

/**
 * Read-only, so this needs no client interactivity -- `audit.view` is
 * Management-only (FIG-438 seed), so this renders only for them anyway.
 */
export function AuditHistory({
  events,
  members,
}: {
  events: AuditEvent[];
  members: Member[];
}) {
  const actorName = (membershipId: string | null) =>
    members.find((m) => m.membershipId === membershipId)?.userName ?? "system";

  return (
    <div className="card">
      <strong>Audit history</strong>
      {events.length === 0 && (
        <p className="who">No audited changes recorded yet.</p>
      )}
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <span className="badge">{e.action}</span>{" "}
            <span className="who">
              {new Date(e.createdAt).toLocaleString()} &middot;{" "}
              {actorName(e.actorMembershipId)}
            </span>
            <div className="who">
              {JSON.stringify(e.previousValue)} &rarr; {JSON.stringify(e.newValue)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
