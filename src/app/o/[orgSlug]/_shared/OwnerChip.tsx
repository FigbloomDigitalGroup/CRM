import { initialsFor } from "./accountCapabilities";

/** Read-only owner display shared by the company and contact tables. */
export function OwnerChip({ name }: { name: string | null }) {
  if (!name) return <span className="owner-chip is-unassigned">Unassigned</span>;
  return (
    <span className="owner-chip">
      <span className="owner-chip-avatar">{initialsFor(name)}</span>
      {name}
    </span>
  );
}
