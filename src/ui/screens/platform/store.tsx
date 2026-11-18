"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  errorText, fetchAdmins, fetchHome, fetchMe, fetchOrgs, fetchRequests, needsReverify, platformCall, platformCsv,
  type CsvCall, type PlatformCall, type SecuritySettings,
} from "./api";
import { DEFAULT_FLAGS, emptyLocal, type LocalState } from "./demo/local";
import { apply, supportMsLeft, type Action, type Result, type WizardForm } from "./logic";
import type { PlatformState } from "./model";

/**
 * The console's data source. Everything the platform API serves (home, organisations, data requests, admins, audit, health, security) is read through
 * react-query from `/api/platform/*` and changed through `actions`. Support access, flags and limits and announcements have no platform API yet; they
 * stay in memory for the visit (`dispatch`, demo/local.ts). Lives in the platform layout, so moving between console pages keeps the cache.
 */

interface Toast {
  id: number;
  text: string;
}

export interface Slice {
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

export type ActionResult<T = unknown> = { ok: true; message?: string; id?: string; data?: T } | { ok: false; message: string };

export interface Verification {
  action: string;
  settle: (ok: boolean) => void;
}

export interface PlatformActions {
  setOrgStatus: (id: string, kind: "suspend" | "reactivate" | "offboard", reason: string) => Promise<ActionResult>;
  provision: (form: WizardForm) => Promise<ActionResult>;
  decide: (id: string, decision: "APPROVE" | "REJECT", comment?: string) => Promise<ActionResult>;
  cancelRequest: (id: string, reason: string) => Promise<ActionResult>;
  retryExport: (id: string) => Promise<ActionResult>;
  runDeletion: (id: string, confirmSlug: string) => Promise<ActionResult>;
  inviteAdmin: (email: string, name: string) => Promise<ActionResult>;
  removeAdmin: (id: string) => Promise<ActionResult>;
  resetTwoStep: (id: string) => Promise<ActionResult>;
  revokeInvite: (id: string) => Promise<ActionResult>;
  updateSecurity: (patch: Record<string, number>) => Promise<ActionResult<SecuritySettings>>;
  createIncident: (input: { component: string; severity: string; title: string; note?: string }) => Promise<ActionResult>;
  resolveIncident: (id: string) => Promise<ActionResult>;
  /** Verify it's you: a fresh code renews the session's verification. Resolves with an error text, or null when it worked. */
  reverify: (code: string) => Promise<string | null>;
  /** Used by the host that shows the verification dialog. */
  finishVerification: (ok: boolean) => void;
}

interface PlatformApi {
  state: PlatformState;
  now: Date;
  /** In-memory changes only (support access, flags and limits, announcements, release shown). */
  dispatch: (a: Action) => Result;
  toast: (text: string) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  call: PlatformCall;
  csv: CsvCall;
  slices: { me: Slice; home: Slice; orgs: Slice; requests: Slice; admins: Slice };
  permissions: string[];
  /** Whether the admin holds a `platform.*` key; until /me answers every control stays visible and the API decides. */
  can: (key: string) => boolean;
  actions: PlatformActions;
  verification: Verification | null;
  /** Refetch every console read (after a change). */
  refresh: () => void;
}

const Ctx = createContext<PlatformApi | null>(null);

export function PlatformStoreProvider({ children, call, csv, queryClient }: { children: ReactNode; call?: PlatformCall; csv?: CsvCall; queryClient?: QueryClient }) {
  const [qc] = useState(() => queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <Inner call={call ?? platformCall} csv={csv ?? platformCsv}>{children}</Inner>
    </QueryClientProvider>
  );
}

function Inner({ children, call, csv }: { children: ReactNode; call: PlatformCall; csv: CsvCall }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<LocalState>(() => emptyLocal());
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [verification, setVerification] = useState<Verification | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const meQ = useQuery({ queryKey: ["platform", "me"], queryFn: () => fetchMe(call) });
  const homeQ = useQuery({ queryKey: ["platform", "home"], queryFn: () => fetchHome(call) });
  const orgsQ = useQuery({ queryKey: ["platform", "orgs"], queryFn: () => fetchOrgs(call) });
  const reqQ = useQuery({ queryKey: ["platform", "requests"], queryFn: () => fetchRequests(call) });
  const adminsQ = useQuery({ queryKey: ["platform", "admins"], queryFn: () => fetchAdmins(call) });

  const state = useMemo<PlatformState>(
    () => ({
      orgs: (orgsQ.data ?? []).map((o) => ({ ...o, flags: local.flags[o.id] ?? DEFAULT_FLAGS })),
      requests: reqQ.data ?? [],
      admins: adminsQ.data?.admins ?? [],
      invitations: adminsQ.data?.invitations ?? [],
      home: homeQ.data ?? null,
      me: meQ.data?.id ?? "",
      release: local.release,
      support: local.support,
      announcement: local.announcement,
      flagHistory: local.flagHistory,
      activeSupport: local.activeSupport,
    }),
    [orgsQ.data, reqQ.data, adminsQ.data, homeQ.data, meQ.data, local],
  );
  const ref = useRef(state);
  ref.current = state;

  const dispatch = useCallback(
    (a: Action): Result => {
      const out = apply(ref.current, a, new Date());
      const s = out.state;
      ref.current = s;
      setLocal((l) => ({
        ...l,
        support: s.support,
        announcement: s.announcement,
        flagHistory: s.flagHistory,
        activeSupport: s.activeSupport,
        release: s.release,
        flags: Object.fromEntries(s.orgs.map((o) => [o.id, o.flags])),
      }));
      if (out.result.message) toast(out.result.message);
      return out.result;
    },
    [toast],
  );

  // The support countdown ticks once a second, and only while a session runs.
  const active = local.activeSupport;
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      const n = new Date();
      setNow(n);
      const s = ref.current.support.find((p) => p.id === active);
      if (s && supportMsLeft(s, n) <= 0) dispatch({ type: "support-expire", id: active });
    }, 1000);
    return () => clearInterval(iv);
  }, [active, dispatch]);

  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ["platform"] }), [qc]);

  const askVerify = useCallback(
    (action: string) =>
      new Promise<boolean>((resolve) => {
        setVerification({ action, settle: resolve });
      }),
    [],
  );
  const finishVerification = useCallback((ok: boolean) => {
    setVerification((v) => {
      v?.settle(ok);
      return null;
    });
  }, []);

  const actions = useMemo<PlatformActions>(() => {
    /** Runs one change. If the API wants a fresh verification, asks for it once and tries again. */
    async function run<T>(what: string, fn: () => Promise<T>, success?: (data: T) => string | undefined, id?: (data: T) => string | undefined): Promise<ActionResult<T>> {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await fn();
          refresh();
          const message = success?.(data);
          if (message) toast(message);
          return { ok: true, message, id: id?.(data), data };
        } catch (e) {
          if (attempt === 0 && needsReverify(e)) {
            if (await askVerify(what)) continue;
            return { ok: false, message: "Not done: this needs a fresh verification." };
          }
          const message = errorText(e);
          toast(message);
          return { ok: false, message };
        }
      }
      return { ok: false, message: "Not done." };
    }
    const enc = encodeURIComponent;
    return {
      setOrgStatus: (id, kind, reason) =>
        run("Changing an organisation’s status", () => call<{ status?: string }>("POST", `/api/platform/organizations/${enc(id)}/status`, { action: kind, reason: reason.trim() }), () =>
          kind === "suspend" ? "Organisation suspended." : kind === "reactivate" ? "Organisation reactivated." : "Offboarding started.",
        ),
      provision: (form) =>
        run("Provisioning an organisation", () => call<{ organizationId: string }>("POST", "/api/platform/organizations", { name: form.name.trim(), slug: form.slug.trim(), ownerName: form.ownerName.trim(), ownerEmail: form.email.trim() }), undefined, (d) => d.organizationId),
      decide: (id, decision, comment) =>
        run("Deciding on a data request", () => call("POST", `/api/platform/data-requests/${enc(id)}/decision`, { decision, ...(comment ? { comment } : {}) }), () => (decision === "APPROVE" ? "Approval recorded." : "Request rejected.")),
      cancelRequest: (id, reason) => run("Cancelling a data request", () => call("POST", `/api/platform/data-requests/${enc(id)}/cancel`, { reason }), () => "Request cancelled."),
      retryExport: (id) => run("Packaging the export again", () => call("POST", `/api/platform/data-requests/${enc(id)}/retry-export`, {}), () => "The export is being packaged again."),
      runDeletion: (id, confirmSlug) => run("Deleting an organisation’s data", () => call("POST", `/api/platform/data-requests/${enc(id)}/delete`, { confirmSlug }), () => "The organisation’s data was deleted. The certificate is stored."),
      inviteAdmin: (email, name) => run("Inviting a platform admin", () => call("POST", "/api/platform/admins", { email: email.trim(), name: name.trim() }), () => "Invite sent. They set up verification at first sign-in."),
      removeAdmin: (id) => run("Removing a platform admin", () => call("DELETE", `/api/platform/admins/${enc(id)}`), () => "Platform admin removed."),
      resetTwoStep: (id) => run("Starting lost-device recovery", () => call("POST", `/api/platform/admins/${enc(id)}/two-step-reset`, {}), () => "Two-step sign-in was reset. The admin enrols again at the next sign-in."),
      revokeInvite: (id) => run("Withdrawing an invite", () => call("DELETE", `/api/platform/invites/${enc(id)}`), () => "Invite withdrawn."),
      updateSecurity: (patch) => run("Changing platform security", () => call<SecuritySettings>("PATCH", "/api/platform/security/settings", patch), () => "Security settings saved."),
      createIncident: (input) => run("Opening an incident", () => call("POST", "/api/platform/health/incidents", input), () => "Incident marked."),
      resolveIncident: (id) => run("Resolving an incident", () => call("POST", `/api/platform/health/incidents/${enc(id)}/resolve`, {}), () => "Incident resolved."),
      reverify: async (code) => {
        try {
          await call("POST", "/api/platform/security/verify", { code });
          return null;
        } catch (e) {
          return errorText(e);
        }
      },
      finishVerification,
    };
  }, [call, toast, refresh, askVerify, finishVerification]);

  const slice = (q: { isLoading: boolean; error: unknown; refetch: () => unknown }): Slice => ({ loading: q.isLoading, error: q.error, refetch: () => void q.refetch() });
  const permissions = meQ.data?.permissionKeys ?? [];
  const value = useMemo<PlatformApi>(
    () => ({
      state, now, dispatch, toast, toasts, dismissToast, call, csv, actions, verification, refresh, permissions,
      can: (key) => !meQ.data || permissions.includes(key),
      slices: { me: slice(meQ), home: slice(homeQ), orgs: slice(orgsQ), requests: slice(reqQ), admins: slice(adminsQ) },
    }),
    [state, now, dispatch, toast, toasts, dismissToast, call, csv, actions, verification, refresh, meQ.status, homeQ.status, orgsQ.status, reqQ.status, adminsQ.status, meQ.error, homeQ.error, orgsQ.error, reqQ.error, adminsQ.error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatform(): PlatformApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlatform must be used inside the platform console");
  return v;
}
