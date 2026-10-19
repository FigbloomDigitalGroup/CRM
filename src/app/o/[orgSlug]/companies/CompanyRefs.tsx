"use client";

import { createContext, useContext } from "react";

export interface CompanyOwner {
  membershipId: string;
  userName: string;
  roleName: string;
}

export interface CompanyRefs {
  lifecycleStates: { id: string; name: string }[];
  /** People a company may be handed to; empty for anyone who cannot reassign. */
  owners: CompanyOwner[];
}

const CompanyRefsContext = createContext<CompanyRefs | null>(null);

/** Wraps the companies table once so each row's edit drawer can read the pickers without re-sending them per row. */
export function CompanyRefsProvider({
  refs,
  children,
}: {
  refs: CompanyRefs;
  children: React.ReactNode;
}) {
  return <CompanyRefsContext.Provider value={refs}>{children}</CompanyRefsContext.Provider>;
}

export function useCompanyRefs(): CompanyRefs {
  const value = useContext(CompanyRefsContext);
  if (!value) throw new Error("useCompanyRefs must be used inside CompanyRefsProvider.");
  return value;
}
