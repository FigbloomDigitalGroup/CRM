"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Who is looking, for screens: the organisation, the membership, the role's name and the permission keys. It is the same data the server
 * layout already resolved (`resolveRequestContext`), handed down once, so a screen can decide what to offer (and what to explain) without a
 * second round trip. It never replaces the server's check: every API route still enforces its own permission.
 */
export interface Member {
  orgSlug: string;
  membershipId: string;
  userName: string;
  roleName: string;
  permissionKeys: readonly string[];
  /** The person's time zone (IANA) for writing dates; null falls back to the browser's. */
  timeZone: string | null;
  /** 12 or 24 hour clock, from the person's preferences. */
  hour12: boolean;
}

const MemberCtx = createContext<Member | null>(null);

export function MemberProvider({ value, children }: { value: Member; children: ReactNode }) {
  return <MemberCtx.Provider value={value}>{children}</MemberCtx.Provider>;
}

export function useMember(): Member & { can: (key: string) => boolean; canAny: (...keys: string[]) => boolean } {
  const m = useContext(MemberCtx);
  if (!m) throw new Error("useMember must be used inside <MemberProvider> (the organisation layout renders it).");
  return {
    ...m,
    can: (key) => m.permissionKeys.includes(key),
    canAny: (...keys) => keys.some((k) => m.permissionKeys.includes(k)),
  };
}

/** For tests and the gallery: a member with the given keys. */
export function testMember(partial: Partial<Member> = {}): Member {
  return { orgSlug: "figbloom", membershipId: "m-1", userName: "Test Member", roleName: "Sales", permissionKeys: [], timeZone: null, hour12: false, ...partial };
}
