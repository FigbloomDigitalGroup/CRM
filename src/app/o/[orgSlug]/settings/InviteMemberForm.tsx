"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RoleOption {
  key: string;
  name: string;
}

export function InviteMemberForm({
  orgSlug,
  roles,
}: {
  orgSlug: string;
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, roleKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send invite.");
      setSuccess(`Invite sent to ${email}.`);
      setName("");
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
      <label>
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Role
        <select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {success && <p className="warning">{success}</p>}
      <button type="submit" disabled={submitting || !roleKey}>
        {submitting ? "Sending invite..." : "Send invite"}
      </button>
    </form>
  );
}
