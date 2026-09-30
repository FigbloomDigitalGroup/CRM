"use client";

import { useRouter } from "next/navigation";
import { IconLogout } from "./_shared/icons";

export function LogoutButton({ withLabel = false }: { withLabel?: boolean }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
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
