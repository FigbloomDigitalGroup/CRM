"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { newIdempotencyKey } from "../../data/client";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import type { AskContext, AssistantMessage, ProposedAction, Respond } from "./types";

/**
 * Ask Figbloom against the real API (FIG-1152, docs/ASSISTANT.md). The panel and Settings only draw; every call is made here.
 * The assistant never decides: `ask` returns a suggestion, and only `confirm` (the member pressing Confirm) makes the server create anything.
 */

export interface AssistantSettingsDto {
  enabled: boolean;
  providerConfigured: boolean;
  options: { summaries: boolean; drafts: boolean; scoring: boolean; retention: boolean };
  limits: { perUser: number; perOrganisation: number };
  usage: { today: number; remaining: number; organisationToday?: number };
  canConfigure: boolean;
}

interface AskAnswer {
  requestId: string;
  message: { who: "ai"; text: string; basis?: string; items?: { title: string; sub: string; href: string }[]; draft?: string; action?: Omit<ProposedAction, "kind"> & { kind: "task" }; actionState?: "pending" };
  usage: { today: number; limit: number };
}

export const assistantSettingsKey = (orgSlug: string) => ["getAssistantSettings", { orgSlug }, null];

/** What the assistant's switch, options and today's usage are. `active` says whether to ask the server now (only while the panel or Settings is open). */
export function useAssistantSettings(active: boolean) {
  const { orgSlug } = useMember();
  return useApiQuery("getAssistantSettings", { params: { orgSlug } }, { enabled: active, retry: false, staleTime: 15_000 });
}

/** The words for an assistant failure: the API's own sentence where it is written for people, the copy deck otherwise. Never a raw error. */
export function explainAssistantError(error: unknown): { text: string; retryable: boolean } {
  const d = describeError(error);
  const env = (error as { envelope?: { code?: string; message?: string; fieldErrors?: { code?: string }[] } } | null)?.envelope;
  if (d.kind === "validation") {
    const unavailable = env?.fieldErrors?.some((f) => f.code === "ASSISTANT_UNAVAILABLE");
    return { text: d.body, retryable: Boolean(unavailable) };
  }
  if (d.kind === "rateLimited") return { text: env?.message || d.body, retryable: false };
  if (d.kind === "noAccess") {
    return env?.code === "FEATURE_UNAVAILABLE"
      ? { text: "The assistant is switched off for your organisation. A Management member can turn it on in Settings, AI assistant.", retryable: false }
      : { text: "Your role is not allowed to use the assistant. Ask a Management member if you need it.", retryable: false };
  }
  if (d.kind === "offline") return { text: "You are offline, so nothing was sent. Try again when you are back online.", retryable: true };
  return { text: "I couldn’t answer that just now. Nothing was changed. Try again in a moment.", retryable: true };
}

let counter = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${++counter}`;

export function useAssistantActions() {
  const api = useApi();
  const qc = useQueryClient();
  const { orgSlug } = useMember();

  const respond: Respond = useCallback(
    async (question: string, ctx: AskContext) => {
      const body = { question, ...(ctx.record?.id ? { record: { kind: ctx.record.kind, id: ctx.record.id } } : {}) };
      const answer = (await api.call("postAssistantAsk", { params: { orgSlug }, body: body as never, idempotencyKey: newIdempotencyKey() })) as unknown as AskAnswer;
      void qc.invalidateQueries({ queryKey: ["getAssistantSettings"] });
      const m = answer.message;
      const reply: AssistantMessage = {
        id: nextId("a"),
        who: "ai",
        text: m.text,
        basis: m.basis,
        items: m.items,
        draft: m.draft,
        action: m.action,
        actionState: m.action ? "pending" : undefined,
        requestId: answer.requestId,
      };
      return [{ id: nextId("q"), who: "me", text: question }, reply];
    },
    [api, orgSlug, qc],
  );

  /** The member said yes. Resolves when the server created the task; throws the API's error otherwise. */
  const confirm = useCallback(
    async (action: ProposedAction) => {
      await api.call("postAssistantProposalsByProposalIdConfirm", { params: { orgSlug, proposalId: action.proposalId }, idempotencyKey: newIdempotencyKey() });
      void qc.invalidateQueries({ queryKey: ["listTasks"] });
    },
    [api, orgSlug, qc],
  );

  const dismiss = useCallback(
    async (action: ProposedAction) => {
      await api.call("postAssistantProposalsByProposalIdDismiss", { params: { orgSlug, proposalId: action.proposalId }, idempotencyKey: newIdempotencyKey() });
    },
    [api, orgSlug],
  );

  const feedback = useCallback(
    async (requestId: string, value: "up" | "down") => {
      await api.call("postAssistantRequestsByRequestIdFeedback", { params: { orgSlug, requestId }, body: { value } as never, idempotencyKey: newIdempotencyKey() });
    },
    [api, orgSlug],
  );

  return useMemo(() => ({ respond, confirm, dismiss, feedback }), [respond, confirm, dismiss, feedback]);
}
