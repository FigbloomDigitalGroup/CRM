"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/dev-session", { method: "DELETE" });
    router.push("/dev-login");
    router.refresh();
  }

  return (
    <button className="secondary" onClick={handleLogout}>
      Log out
    </button>
  );
}
