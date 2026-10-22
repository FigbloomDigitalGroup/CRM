"use client";

import { useRouter } from "next/navigation";

export function PlatformSignOut() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/dev-session", { method: "DELETE" });
    router.push("/dev-login");
    router.refresh();
  }
  return (
    <button type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
