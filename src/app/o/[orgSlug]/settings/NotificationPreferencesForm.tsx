"use client";

import { useState } from "react";

type NotificationType = "LEAD_ASSIGNED" | "TASK_DUE" | "TASK_OVERDUE";

const LABELS: Record<NotificationType, string> = {
  LEAD_ASSIGNED: "A new lead is assigned to me",
  TASK_DUE: "One of my tasks is due today",
  TASK_OVERDUE: "One of my tasks is overdue",
};

export interface NotificationPreferenceRow {
  type: NotificationType;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

/** Self-service -- always the signed-in user's own preferences; no permission gate beyond being an active member of this organization. */
export function NotificationPreferencesForm({
  orgSlug,
  preferences,
}: {
  orgSlug: string;
  preferences: NotificationPreferenceRow[];
}) {
  const [rows, setRows] = useState(preferences);
  const [savingType, setSavingType] = useState<NotificationType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(
    type: NotificationType,
    field: "emailEnabled" | "inAppEnabled",
    value: boolean,
  ) {
    const previous = rows;
    setRows((prev) => prev.map((r) => (r.type === type ? { ...r, [field]: value } : r)));
    setSavingType(type);
    setError(null);
    try {
      const row = rows.find((r) => r.type === type)!;
      const res = await fetch(`/api/orgs/${orgSlug}/notification-preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...row, [field]: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save.");
    } catch (err) {
      setRows(previous);
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Notification</th>
            <th>Email</th>
            <th>In-app</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.type}>
              <td>{LABELS[row.type]}</td>
              <td>
                <input
                  type="checkbox"
                  checked={row.emailEnabled}
                  disabled={savingType === row.type}
                  onChange={(e) => handleChange(row.type, "emailEnabled", e.target.checked)}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.inAppEnabled}
                  disabled={savingType === row.type}
                  onChange={(e) => handleChange(row.type, "inAppEnabled", e.target.checked)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
