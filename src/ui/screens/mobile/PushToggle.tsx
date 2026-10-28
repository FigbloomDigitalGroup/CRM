"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { Icon } from "../leads/icons";
import { isStandalone, isIos, pushSupported, subscribeThisDevice, unsubscribeThisDevice } from "./pwa";

const idKey = (org: string) => `figbloom-push-sub:${org}`;

/**
 * "Alerts on this phone" (S3): subscribes this device for Web Push. Says why when it cannot: the browser has no push, the server is not set
 * up for it, the person blocked it, or (iPhone) the app has to be added to the Home Screen first. Which events are pushed is chosen in
 * the notification preferences; this only registers the device.
 */
export function PushToggle() {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const cfg = useApiQuery("getPushConfig", { params: { orgSlug } }, { staleTime: 60_000 });
  const subs = useApiQuery("listMyPushSubscriptions", { params: { orgSlug } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPerm(pushSupported() ? Notification.permission : "unsupported");
  }, []);

  const configured = (cfg.data as { configured?: boolean } | undefined)?.configured === true;
  const publicKey = (cfg.data as { publicKey?: string | null } | undefined)?.publicKey ?? null;
  const items = ((subs.data as { items?: { id: string }[] } | undefined)?.items ?? []) as { id: string }[];
  let heldId: string | null = null;
  try {
    heldId = typeof window !== "undefined" ? window.localStorage.getItem(idKey(orgSlug)) : null;
  } catch {
    heldId = null;
  }
  const on = Boolean(heldId && items.some((s) => s.id === heldId));

  let note: string | null = null;
  let disabled = false;
  if (perm === "unsupported") {
    note = isIos() && !isStandalone() ? "On iPhone, add the app to your Home Screen first." : "This browser cannot receive alerts.";
    disabled = true;
  } else if (cfg.isSuccess && !configured) {
    note = "Alerts are not switched on for this organisation yet.";
    disabled = true;
  } else if (perm === "denied") {
    note = "Blocked in your phone's settings for this site.";
    disabled = true;
  }

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPerm(result);
      if (result !== "granted") return;
      const details = await subscribeThisDevice(publicKey);
      const res = (await api.call("registerPushSubscription", { params: { orgSlug }, body: { ...details, userAgent: navigator.userAgent.slice(0, 200) } })) as unknown as { id?: string };
      if (res.id) window.localStorage.setItem(idKey(orgSlug), res.id);
      await qc.invalidateQueries({ queryKey: ["listMyPushSubscriptions"] });
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      if (heldId) await api.call("removeMyPushSubscription", { params: { orgSlug, subscriptionId: heldId } }).catch(() => undefined);
      await unsubscribeThisDevice().catch(() => undefined);
      window.localStorage.removeItem(idKey(orgSlug));
      await qc.invalidateQueries({ queryKey: ["listMyPushSubscriptions"] });
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="fb-m-toggle">
        <Icon name="bell" size={18} />
        <span style={{ flex: 1 }}>
          Alerts on this phone
          <small>{note ?? (on ? "On. You choose which ones in Preferences." : "Off")}</small>
        </span>
        <button
          type="button"
          className="fb-m-chip"
          role="switch"
          aria-checked={on}
          aria-label="Alerts on this phone"
          aria-disabled={disabled || busy || undefined}
          disabled={disabled || busy}
          onClick={() => void (on ? turnOff() : turnOn())}
        >
          {busy ? "…" : on ? "On" : "Turn on"}
        </button>
      </div>
      {error ? (
        <div className="fb-m-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
