"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApi } from "../data/hooks";

/** The card at the foot of the sidebar: your initial, name, role and a sign-out button. Collapses to the initial alone. */
export function SidebarUser({ name, roleName }: { name: string; roleName: string }) {
  const api = useApi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api.call("logout", { params: {} });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="fb-sideuser">
      <span className="fb-sideuser__dot" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span className="fb-sideuser__text fb-sidebar__text">
        <span className="fb-sideuser__name">{name}</span>
        <span className="fb-sideuser__role">{roleName}</span>
      </span>
      <button type="button" className="fb-sideuser__out fb-sidebar__text" aria-label="Sign out" title="Sign out" aria-disabled={busy || undefined} onClick={signOut}>
        <LogOut size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
