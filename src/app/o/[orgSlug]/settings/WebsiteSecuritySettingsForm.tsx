"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Two independent forms rather than one, on purpose: allowed origins and
 * the honeypot field name are never secret, so their form always sends
 * both (replacing whatever's there, blank = disabled). The captcha secret
 * is never echoed back by the server (only whether one is configured), so
 * it needs its own explicit "set/replace" vs. "remove" actions instead of
 * a pre-filled field a blank submit would ambiguously clear.
 */
export function WebsiteSecuritySettingsForm({
  orgSlug,
  allowedOrigins,
  honeypotFieldName,
  captchaConfigured,
}: {
  orgSlug: string;
  allowedOrigins: string[];
  honeypotFieldName: string | null;
  captchaConfigured: boolean;
}) {
  const router = useRouter();
  const [origins, setOrigins] = useState(allowedOrigins.join(", "));
  const [honeypot, setHoneypot] = useState(honeypotFieldName ?? "");
  const [captchaSecret, setCaptchaSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<
    "origins" | "captcha-set" | "captcha-remove" | null
  >(null);

  async function postSettings(body: Record<string, unknown>) {
    const res = await fetch(
      `/api/orgs/${orgSlug}/integrations/website-key/settings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const responseBody = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(responseBody.error ?? "Failed to save.");
    router.refresh();
  }

  async function handleOriginsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting("origins");
    setError(null);
    try {
      const parsedOrigins = origins
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      await postSettings({
        allowedOrigins: parsedOrigins,
        honeypotFieldName: honeypot.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSetCaptcha(e: React.FormEvent) {
    e.preventDefault();
    if (!captchaSecret.trim()) return;
    setSubmitting("captcha-set");
    setError(null);
    try {
      await postSettings({ captchaSecret: captchaSecret.trim() });
      setCaptchaSecret("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRemoveCaptcha() {
    setSubmitting("captcha-remove");
    setError(null);
    try {
      await postSettings({ captchaSecret: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="stack">
      <form className="stack" onSubmit={handleOriginsSubmit}>
        <label>
          Allowed origins (optional, comma-separated)
          <input
            type="text"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder="https://figbloom.com, https://www.figbloom.com"
          />
        </label>
        <p className="who">
          Leave blank to accept any origin (or none -- the documented
          integration is server-to-server and may send no Origin header at
          all).
        </p>
        <label>
          Honeypot field name (optional)
          <input
            type="text"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            placeholder="e.g. website"
          />
        </label>
        <p className="who">
          If set, the website form should include a hidden field with this
          name that real visitors never fill in. A submission with it
          filled in is silently discarded -- logged below, but told it
          succeeded.
        </p>
        <button type="submit" disabled={submitting === "origins"}>
          {submitting === "origins" ? "Saving..." : "Save"}
        </button>
      </form>

      <div>
        <label>
          Captcha secret (Cloudflare Turnstile) --{" "}
          {captchaConfigured ? "configured" : "not configured"}
        </label>
        <form
          className="stack"
          onSubmit={handleSetCaptcha}
          style={{ marginTop: 6 }}
        >
          <input
            type="password"
            value={captchaSecret}
            onChange={(e) => setCaptchaSecret(e.target.value)}
            placeholder="Turnstile secret key"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={submitting === "captcha-set" || !captchaSecret.trim()}
            >
              {submitting === "captcha-set" ? "Saving..." : "Set / replace"}
            </button>
            {captchaConfigured && (
              <button
                type="button"
                onClick={handleRemoveCaptcha}
                disabled={submitting === "captcha-remove"}
              >
                {submitting === "captcha-remove" ? "Removing..." : "Remove"}
              </button>
            )}
          </div>
        </form>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
