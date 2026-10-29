"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useApiMutation, useApiQuery, queryKeyFor, useMember, useToast, explainRollback } from "@/ui";
import type { NotificationPrefsView, PreferencesView, ProfileView, SessionRow, SignInEventRow } from "./model";

/** The member's preferences (B1.08): look, density, start page, sidebar and the date and time choices. */
export function usePreferencesQuery() {
  const { orgSlug } = useMember();
  const query = useApiQuery("getMyPreferences", { params: { orgSlug } });
  return { ...query, prefs: query.data as unknown as PreferencesView | undefined };
}

export function useProfileQuery() {
  const { orgSlug } = useMember();
  const query = useApiQuery("getMyProfile", { params: { orgSlug } });
  return { ...query, profile: query.data as unknown as ProfileView | undefined };
}

export function useNotificationPrefsQuery() {
  const { orgSlug } = useMember();
  const query = useApiQuery("getMyNotificationPreferences", { params: { orgSlug } });
  return { ...query, view: query.data as unknown as NotificationPrefsView | undefined };
}

export function useSessionsQuery() {
  const query = useApiQuery("listMySessions", undefined as never, { refetchOnWindowFocus: true });
  return { ...query, sessions: ((query.data as unknown as { items: SessionRow[] } | undefined)?.items ?? []) as SessionRow[] };
}

export function useSignInEventsQuery() {
  const query = useApiQuery("listMySignInEvents", undefined as never);
  return { ...query, events: ((query.data as unknown as { items: SignInEventRow[] } | undefined)?.items ?? []) as SignInEventRow[] };
}

type PrefsBody = Record<string, unknown>;

/**
 * Saves a change to the member's preferences. The caller has already applied it to the screen (every control changes the app at once);
 * if the server says no, `revert` puts it back and a toast says why. A success can offer Undo, which saves the previous values.
 */
export function useSavePreferences() {
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const mutation = useApiMutation("updateMyPreferences");
  const key = queryKeyFor("getMyPreferences", { params: { orgSlug } });

  async function save(opts: { body: PrefsBody; message: string; undoBody?: PrefsBody; revert?: () => void; reapply?: (view: PreferencesView) => void; refreshShell?: boolean }) {
    try {
      const view = (await mutation.mutateAsync({ params: { orgSlug }, body: opts.body as never })) as unknown as PreferencesView;
      qc.setQueryData(key, view);
      opts.reapply?.(view);
      if (opts.refreshShell) router.refresh();
      toast.show({
        message: view.ignored && view.ignored.length > 0 ? `${opts.message} Some changes were not saved: your organisation controls the look.` : opts.message,
        undo: opts.undoBody
          ? async () => {
              const back = (await mutation.mutateAsync({ params: { orgSlug }, body: opts.undoBody as never })) as unknown as PreferencesView;
              qc.setQueryData(key, back);
              opts.reapply?.(back);
              if (opts.refreshShell) router.refresh();
            }
          : undefined,
      });
      return view;
    } catch (error) {
      opts.revert?.();
      toast.show({ tone: "danger", message: explainRollback(error, opts.message.replace(/\.$/, "")) });
      void qc.invalidateQueries({ queryKey: key });
      return null;
    }
  }
  return { save, saving: mutation.isPending, queryKey: key };
}
