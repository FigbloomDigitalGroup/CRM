"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

const THEME_STORAGE_KEY = "figbloom-theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "dark") {
        document.documentElement.dataset.theme = "dark";
        setIsDark(true);
      }
    } catch {
      // localStorage unavailable -- default to light.
    }
  }, []);

  function toggle() {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.dataset.theme = next ? "dark" : "light";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      } catch {
        // Best-effort persistence only.
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      className="icon-button"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
