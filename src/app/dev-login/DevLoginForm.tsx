"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  email: string;
  name: string;
  roleName: string;
}

export function DevLoginForm({ options }: { options: Option[] }) {
  const router = useRouter();
  const [email, setEmail] = useState(options[0]?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dev-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Login failed.");
      }
      router.push("/o/figbloom");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Log in as
        <select value={email} onChange={(e) => setEmail(e.target.value)}>
          {options.map((opt) => (
            <option key={opt.email} value={opt.email}>
              {opt.name} -- {opt.roleName} ({opt.email})
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting || options.length === 0}>
        {submitting ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
