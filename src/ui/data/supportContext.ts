"use client";

import { createContext, useContext } from "react";

/** The opener for the one "Contact support" dialog (FIG-1594). Kept apart from the dialog so shared components can use it without a cycle. */
export interface SupportApi {
  open: () => void;
}
export const SupportContext = createContext<SupportApi | null>(null);

/** The opener, or null where there is no signed-in shell (sign-in pages, the platform console): an entry point then does not draw. */
export function useContactSupport(): SupportApi | null {
  return useContext(SupportContext);
}
