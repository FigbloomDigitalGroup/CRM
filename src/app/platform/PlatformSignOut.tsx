"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** Ends the dev Super Admin's session and returns to the dev sign-in. Styled by whoever places it (the console's account menu passes its own class). */
export function PlatformSignOut({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/dev-session", { method: "DELETE" });
    router.push("/dev-login");
    router.refresh();
  }
  return (
    <button type="button" className={className} onClick={signOut}>
      {children ?? "Sign out"}
    </button>
  );
}
