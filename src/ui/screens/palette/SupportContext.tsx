"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { SupportContext } from "../../data/supportContext";
import { ContactSupportDialog } from "./ContactSupportDialog";

/**
 * One "Contact support" dialog for the whole signed-in app (FIG-1594). The shell mounts the provider once; every entry point (sidebar,
 * user menu, phone menu, command palette, Help panel, error and 404 states) calls `open()`. It reuses `ContactSupportDialog` and the
 * existing support-request route: there is no second channel.
 */
export function SupportProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <SupportContext.Provider value={value}>
      {children}
      {isOpen ? <ContactSupportDialog onClose={() => setOpen(false)} /> : null}
    </SupportContext.Provider>
  );
}
