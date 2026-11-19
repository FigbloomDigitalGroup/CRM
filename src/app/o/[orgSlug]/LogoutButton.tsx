"use client";

import { useRouter } from "next/navigation";
import { IconLogout } from "./_shared/icons";

export function LogoutButton({ withLabel = false }: { withLabel?: boolean }) {
  const router = useRouter();

  async function handleLogout() {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    // with Figbloom sign-in, the sign-in page ends its own session too, then shows "You're signed out"
    const body = (await res.json().catch(() => null)) as { logoutUrl?: unknown } | null;
    if (typeof body?.logoutUrl === "string") {
      window.location.assign(body.logoutUrl);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      className="sidebar-logout"
      onClick={handleLogout}
      title="Log out"
      aria-label="Log out"
    >
      <IconLogout />
      {withLabel && <span>Log out</span>}
    </button>
  );
}
