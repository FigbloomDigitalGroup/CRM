"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInAsDevAccount } from "@/ui/data/client";

export interface DevChipAccount {
  email: string;
  name: string;
  roleName: string;
  note: string | null;
}

/** A small floating panel, collapsed by default. The `data-figbloom-dev-chips` marker is what the production build check looks for. */
export function DevChipsPanel({ accounts }: { accounts: DevChipAccount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(email: string) {
    setBusy(email);
    setError(null);
    const result = await signInAsDevAccount(email);
    if (result.ok) {
      router.push(result.landing);
      router.refresh();
    } else {
      setError(result.message);
    }
    setBusy(null);
  }

  return (
    <div data-figbloom-dev-chips style={{ position: "fixed", left: 12, bottom: 12, zIndex: 2147483000, fontFamily: "system-ui, sans-serif", fontSize: 13 }}>
      {open ? (
        <div role="group" aria-label="Dev sign-in" style={{ background: "#17241b", color: "#f2f5f1", borderRadius: 14, padding: 12, width: 300, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Dev sign-in &middot; local only</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {accounts.map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={busy !== null}
                onClick={() => signIn(a.email)}
                title={a.email}
                style={{ textAlign: "left", background: "#fff", color: "#17241b", border: 0, borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}
              >
                <strong>{a.name}</strong>
                <span style={{ display: "block", opacity: 0.8 }}>
                  {a.roleName}
                  {a.note ? ` (${a.note})` : ""}
                </span>
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" style={{ color: "#ffb4ab", margin: "8px 0 0" }}>
              {error}
            </p>
          ) : null}
          <button type="button" onClick={() => setOpen(false)} style={{ marginTop: 8, background: "transparent", color: "#f2f5f1", border: "1px solid #5b6f60", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>
            Close
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={{ background: "#17241b", color: "#f2f5f1", border: 0, borderRadius: 999, padding: "8px 14px", cursor: "pointer", fontWeight: 600 }}>
          Dev sign-in
        </button>
      )}
    </div>
  );
}
