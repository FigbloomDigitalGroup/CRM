"use client";

import { createContext, useContext } from "react";
import type { Owner } from "./[leadId]/EditLeadForm";

interface Option {
  id: string;
  name: string;
}

export interface LeadRefs {
  leadStatuses: (Option & { key: string })[];
  leadSources: Option[];
  lostReasons: Option[];
  /** Members a lead may be handed to; empty for anyone without `leads.assign`. */
  owners: Owner[];
}

const LeadRefsContext = createContext<LeadRefs | null>(null);

/**
 * Wraps the leads table once so each row's edit drawer can read the
 * reference lists without the server re-sending them with every row.
 */
export function LeadRefsProvider({
  refs,
  children,
}: {
  refs: LeadRefs;
  children: React.ReactNode;
}) {
  return <LeadRefsContext.Provider value={refs}>{children}</LeadRefsContext.Provider>;
}

export function useLeadRefs(): LeadRefs {
  const value = useContext(LeadRefsContext);
  if (!value) throw new Error("useLeadRefs must be used inside LeadRefsProvider.");
  return value;
}
