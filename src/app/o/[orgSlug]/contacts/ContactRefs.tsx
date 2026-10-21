"use client";

import { createContext, useContext } from "react";

export interface ContactOwner {
  membershipId: string;
  userName: string;
  roleName: string;
}

export interface ContactRefs {
  /** Active companies a contact may be filed under; empty when the viewer cannot view companies. */
  companies: { id: string; name: string }[];
  /** People a contact may be handed to; empty for anyone who cannot reassign. */
  owners: ContactOwner[];
}

const ContactRefsContext = createContext<ContactRefs | null>(null);

/** Wraps the contacts table once so each row's edit drawer can read the pickers without re-sending them per row. */
export function ContactRefsProvider({
  refs,
  children,
}: {
  refs: ContactRefs;
  children: React.ReactNode;
}) {
  return <ContactRefsContext.Provider value={refs}>{children}</ContactRefsContext.Provider>;
}

export function useContactRefs(): ContactRefs {
  const value = useContext(ContactRefsContext);
  if (!value) throw new Error("useContactRefs must be used inside ContactRefsProvider.");
  return value;
}
