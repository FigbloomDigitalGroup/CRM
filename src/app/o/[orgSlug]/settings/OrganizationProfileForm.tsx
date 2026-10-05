"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrganizationProfile } from "@/services/organizationProfileService";

const WORKING_DAY_LABELS: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};
const WORKING_DAY_KEYS = Object.keys(WORKING_DAY_LABELS);

/** Management-only (`organization.manage_settings`, FIG-604) -- tenant profile/defaults/working-hours, the settings page's one previously-missing "who is this organization" section. */
export function OrganizationProfileForm({
  orgSlug,
  profile,
  timezones,
}: {
  orgSlug: string;
  profile: OrganizationProfile;
  timezones: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(profile);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleDay(day: string) {
    setForm((prev) => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter((d) => d !== day)
        : [...prev.workingDays, day],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          workingHoursStart: form.workingHoursStart || null,
          workingHoursEnd: form.workingHoursEnd || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save.");
      setForm(body);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" style={{ maxWidth: 520 }} onSubmit={handleSubmit}>
      <label>
        Organization name
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </label>

      <label>
        Phone
        <input
          value={form.phone ?? ""}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </label>

      <label>
        Website
        <input
          value={form.website ?? ""}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
        />
      </label>

      <label>
        Address
        <input
          value={form.address ?? ""}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </label>

      <label>
        Timezone
        <select
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>

      <label>
        Default currency
        <input
          value={form.defaultCurrency}
          maxLength={3}
          style={{ textTransform: "uppercase", width: 80 }}
          onChange={(e) =>
            setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })
          }
          required
        />
      </label>

      <div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>
          Working days
        </span>
        <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
          {WORKING_DAY_KEYS.map((day) => (
            <label key={day} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <input
                type="checkbox"
                checked={form.workingDays.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {WORKING_DAY_LABELS[day]}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ flex: 1 }}>
          Working hours start
          <input
            type="time"
            value={form.workingHoursStart ?? ""}
            onChange={(e) => setForm({ ...form, workingHoursStart: e.target.value })}
          />
        </label>
        <label style={{ flex: 1 }}>
          Working hours end
          <input
            type="time"
            value={form.workingHoursEnd ?? ""}
            onChange={(e) => setForm({ ...form, workingHoursEnd: e.target.value })}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </button>
        {saved && !error && <span className="who">Saved.</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
