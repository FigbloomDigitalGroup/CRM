"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Toasts } from "./kit";
import { PlatformStoreProvider } from "./store";

const KEY = "figbloom-platform-theme";

interface ThemeApi {
  theme: "light" | "dark";
  toggle: () => void;
}
const ThemeCtx = createContext<ThemeApi>({ theme: "light", toggle: () => {} });
export const usePlatformTheme = () => useContext(ThemeCtx);

/**
 * The console's root: its own look (light or dark, remembered on this device only), the demo store and the toast area. Everything under
 * /platform sits inside it, the sign-in step and platform mobile included. It never loads the tenant stylesheet or theme.
 */
export function PlatformRoot({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {
      /* storage can be unavailable; the default look is fine */
    }
  }, []);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <PlatformStoreProvider>
        <div className="fb-pl" data-pl-theme={theme}>
          {children}
          <Toasts />
        </div>
      </PlatformStoreProvider>
    </ThemeCtx.Provider>
  );
}
