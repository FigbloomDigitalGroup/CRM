"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  appearanceAttrs,
  defaultScheme,
  lookStyles,
  readDevicePrefs,
  resolveScheme,
  writeDevicePrefs,
  DEFAULT_DEVICE,
  DEVICE_STORAGE_KEY,
  type DevicePrefs,
  type LookInput,
  type Scheme,
} from "./resolve";

/**
 * Applies the resolved look to the authenticated app (F1.01). The server renders the tokens for both schemes and the initial attributes, a
 * tiny inline script (`NoFlashScript`) applies this device's settings before the first paint, and this provider keeps everything live
 * afterwards: any change to the look or the device settings updates the whole app without a reload. It only ever touches `.fb-app`
 * (and `data-theme` on `<html>`, which the older stylesheet keys its dark rules on), so the frozen sign-in pages never see it.
 */

interface AppearanceContext {
  look: LookInput;
  density: string | null | undefined;
  device: DevicePrefs;
  scheme: Scheme;
  /** The organisation locked the look: the light/dark switch is disabled and says why. */
  locked: boolean;
  setLook: (look: LookInput) => void;
  setDensity: (density: string) => void;
  setDevice: (patch: Partial<DevicePrefs>) => void;
  toggleScheme: () => void;
}

const Ctx = createContext<AppearanceContext | null>(null);

export function useAppearance(): AppearanceContext {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppearance must be used inside <ThemeProvider>.");
  return value;
}

/** Safe outside a provider (the component gallery, tests): reports the defaults. */
export function useAppearanceOptional(): AppearanceContext | null {
  return useContext(Ctx);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeSystem(onChange: () => void) {
  const mq = typeof matchMedia === "function" ? matchMedia(DARK_QUERY) : null;
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}
const systemDarkNow = () => (typeof matchMedia === "function" ? matchMedia(DARK_QUERY).matches : false);

export function ThemeProvider({
  initialLook,
  initialDensity,
  children,
}: {
  initialLook: LookInput;
  initialDensity: string | null | undefined;
  children: React.ReactNode;
}) {
  const [look, setLook] = useState(initialLook);
  const [density, setDensity] = useState(initialDensity);
  const [device, setDeviceState] = useState<DevicePrefs>(DEFAULT_DEVICE);
  const [deviceReady, setDeviceReady] = useState(false);
  const systemDark = useSyncExternalStore(subscribeSystem, systemDarkNow, () => false);
  const ref = useRef<HTMLDivElement>(null);

  // The device store is read after mount (the server cannot see it); the inline script has already painted it.
  useEffect(() => {
    setDeviceState(readDevicePrefs());
    setDeviceReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEVICE_STORAGE_KEY) setDeviceState(readDevicePrefs());
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);

  const scheme = resolveScheme(look, device, systemDark);
  // Until the device store is read, keep whatever the inline script chose rather than flashing the server's default.
  const attrs = useMemo(() => appearanceAttrs({ scheme, density, device }), [scheme, density, device]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !deviceReady) return;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.documentElement.setAttribute("data-theme", attrs["data-fb-scheme"]);
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [attrs, deviceReady]);

  const setDevice = useCallback((patch: Partial<DevicePrefs>) => {
    setDeviceState((prev) => {
      const next = { ...prev, ...patch };
      writeDevicePrefs(next);
      return next;
    });
  }, []);

  const toggleScheme = useCallback(() => {
    if (look.locked) return;
    setDevice({ scheme: scheme === "dark" ? "light" : "dark" });
  }, [look.locked, scheme, setDevice]);

  const value = useMemo<AppearanceContext>(
    () => ({ look, density, device, scheme, locked: look.locked, setLook, setDensity, setDevice, toggleScheme }),
    [look, density, device, scheme, setDevice, toggleScheme],
  );

  const css = useMemo(() => lookStyles(look), [look]);
  const initial = appearanceAttrs({ scheme: defaultScheme(initialLook, false), density: initialDensity, device: DEFAULT_DEVICE });

  return (
    <Ctx.Provider value={value}>
      <div
        ref={ref}
        className="fb-app"
        data-fb-default={initialLook.colours.page.hex ? (initialLook.colours.page.dark ? "dark" : "light") : "device"}
        data-fb-locked={initialLook.locked ? "1" : "0"}
        suppressHydrationWarning
        {...initial}
      >
        <style id="fb-look" dangerouslySetInnerHTML={{ __html: css }} />
        {children}
      </div>
    </Ctx.Provider>
  );
}
