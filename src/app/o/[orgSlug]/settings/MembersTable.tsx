"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Member {
  membershipId: string;
  userName: string;
  userEmail: string;
  roleKey: string;
  roleName: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  invitedAt: string | null;
  joinedAt: string | null;
}

interface RoleOption {
  key: string;
  name: string;
}

export function MembersTable({
  orgSlug,
  members,
  roles,
  canAssignRole,
  canManage,
}: {
  orgSlug: string;
  members: Member[];
  roles: RoleOption[];
  canAssignRole: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function runAction(
    membershipId: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    setBusyId(membershipId);
    setErrors((prev) => ({ ...prev, [membershipId]: "" }));
    try {
      const res = await fetch(
        `/api/orgs/${orgSlug}/memberships/${membershipId}${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error ?? "Action failed.");
      router.refresh();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [membershipId]: err instanceof Error ? err.message : "Action failed.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.membershipId}>
            <td>{m.userName}</td>
            <td>{m.userEmail}</td>
            <td>
              {canAssignRole ? (
                <select
                  value={m.roleKey}
                  disabled={busyId === m.membershipId}
                  onChange={(e) =>
                    runAction(m.membershipId, "/role", { roleKey: e.target.value })
                  }
                >
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                m.roleName
              )}
            </td>
            <td>{m.status}</td>
            <td>
              {canManage && m.status === "PENDING" && (
                <button
                  type="button"
                  disabled={busyId === m.membershipId}
                  onClick={() => runAction(m.membershipId, "/resend-invite")}
                >
                  Resend invite
                </button>
              )}
              {canManage && m.status === "ACTIVE" && (
                <button
                  type="button"
                  disabled={busyId === m.membershipId}
                  onClick={() => runAction(m.membershipId, "/deactivate")}
                >
                  Deactivate
                </button>
              )}
              {canManage && m.status === "INACTIVE" && (
                <button
                  type="button"
                  disabled={busyId === m.membershipId}
                  onClick={() => runAction(m.membershipId, "/reactivate")}
                >
                  Reactivate
                </button>
              )}
              {errors[m.membershipId] && (
                <div className="error">{errors[m.membershipId]}</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
