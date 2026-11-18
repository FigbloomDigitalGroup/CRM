"use client";

import Link from "next/link";
import { Check, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { explainAssistantError } from "./api";
import type { AskContext, AssistantMessage, ProposedAction, Respond } from "./types";

const PROMPTS = ["Which proposals have no reply after a week?", "Show Hot leads with no task", "What’s overdue?", "What’s my open pipeline worth?"];

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  /** The organisation's switch (Settings, AI assistant). Off: the panel explains and offers nothing. */
  enabled: boolean;
  ctx: AskContext;
  /** Asks the real API (`useAssistantActions().respond`). */
  respond: Respond;
  /** Runs the confirmed action on the server. Nothing calls this until the person presses Confirm; the card says Done only after it resolves. */
  onConfirmAction: (action: ProposedAction) => Promise<void>;
  /** Tells the server the suggestion was declined (Not now). */
  onDismissAction?: (action: ProposedAction) => Promise<void>;
  onFeedback?: (requestId: string, value: "up" | "down") => Promise<void>;
  settingsHref?: string;
  /** Today's usage, from the server (`/assistant/settings`). Null while it loads or when it could not be read. */
  usage?: { today: number; limit: number } | null;
  /** Set when the server says the assistant cannot be used (switched off, release, role, not set up): the panel explains it and shows no input. */
  unavailable?: string | null;
  loading?: boolean;
}

/**
 * Ask Figbloom (X2, FIG-1171): a panel beside the page. It answers questions about records the person can open, drafts messages for them to edit
 * and send themselves, and proposes actions as cards. An action runs only when the person presses Confirm on its card; a card that is not
 * confirmed does nothing. When the organisation switches the assistant off the panel says so and shows no input.
 */
export function AssistantPanel({ open, onClose, enabled, ctx, respond, onConfirmAction, onDismissAction, onFeedback, settingsHref, usage = null, unavailable = null, loading = false }: AssistantPanelProps) {
  const [thread, setThread] = useState<AssistantMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const lastQuestion = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && enabled) input.current?.focus();
  }, [open, enabled]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [thread.length, busy]);

  if (!open) return null;

  const limit = usage?.limit ?? null;
  const used = usage ? Math.max(usage.today, usage ? 0 : sent) : sent;
  const atLimit = limit !== null && used >= limit;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy || atLimit) return;
    lastQuestion.current = q;
    setText("");
    setBusy(true);
    try {
      const replies = await respond(q, ctx);
      setThread((t) => [...t.filter((m) => !m.error), ...replies]);
      setSent((n) => n + 1);
    } catch (e) {
      const why = explainAssistantError(e);
      setThread((t) => [...t.filter((m) => !m.error), { id: `e${Date.now()}`, who: "ai", error: true, retryable: why.retryable, text: why.text }]);
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, change: Partial<AssistantMessage>) => setThread((t) => t.map((m) => (m.id === id ? { ...m, ...change } : m)));

  async function confirm(m: AssistantMessage) {
    if (!m.action || m.actionState !== "pending") return;
    patch(m.id, { actionState: "confirming", actionError: undefined });
    try {
      await onConfirmAction(m.action);
      patch(m.id, { actionState: "confirmed" });
    } catch (e) {
      patch(m.id, { actionState: "pending", actionError: explainAssistantError(e).text });
    }
  }

  async function decline(m: AssistantMessage) {
    if (!m.action) return;
    patch(m.id, { actionState: "dismissed" });
    try {
      await onDismissAction?.(m.action);
    } catch {
      /* the card is gone for this person either way; an unanswered suggestion expires on its own after 30 minutes */
    }
  }

  function rate(m: AssistantMessage, value: "up" | "down") {
    patch(m.id, { feedback: value });
    if (m.requestId) void onFeedback?.(m.requestId, value)?.catch(() => patch(m.id, { feedback: undefined }));
  }

  return (
    <aside className="fb-ask" role="complementary" aria-label="Ask Figbloom" data-testid="assistant-panel">
      <header className="fb-ask__head">
        <span className="fb-ask__logo" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <div className="fb-ask__title">
          <strong>Ask Figbloom</strong>
          <span>
            Sees what {ctx.roleName} can see · 
          </span>
        </div>
        <button type="button" className="fb-ask__x" aria-label="Close Ask Figbloom" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {unavailable ? (
        <div className="fb-ask__off" role="status" data-testid="assistant-unavailable">
          <strong>The assistant isn’t available</strong> {unavailable}
        </div>
      ) : loading ? (
        <div className="fb-ask__off" role="status" data-testid="assistant-loading">
          Checking whether the assistant is on for your organisation…
        </div>
      ) : !enabled ? (
        <div className="fb-ask__off" role="status" data-testid="assistant-off">
          <strong>The assistant is switched off</strong> for your organisation. Nothing you type here is read or sent anywhere.
          {settingsHref ? (
            <>
              {" "}
              A Management member can turn it on in <Link href={settingsHref}>Settings, AI assistant</Link>.
            </>
          ) : (
            " A Management member can turn it on in Settings, AI assistant."
          )}
        </div>
      ) : (
        <>
          <div className="fb-ask__body" aria-live="polite">
            {ctx.record ? (
              <div className="fb-ask__ctx">
                <span className="fb-ask__eyebrow">ASKING ABOUT THIS {ctx.record.kind.toUpperCase()}</span>
                <strong>{ctx.record.name}</strong>
                <button type="button" className="fb-ask__chip" onClick={() => void ask(`Draft a follow-up for ${ctx.record!.name}`)}>
                  Draft a follow-up
                </button>
              </div>
            ) : null}

            {thread.map((m) => (
              <div key={m.id} className="fb-ask__msg" data-who={m.who} data-error={m.error || undefined}>
                {m.who === "ai" && !m.error ? (
                  <div className="fb-ask__tag">
                    <Sparkles size={12} aria-hidden="true" /> SUGGESTED
                  </div>
                ) : null}
                <div>{m.text}</div>
                {m.error && m.retryable ? (
                  <button type="button" className="fb-ask__chip" onClick={() => void ask(lastQuestion.current)}>
                    Try again
                  </button>
                ) : null}
                {m.items?.length ? (
                  <div className="fb-ask__items">
                    {m.items.map((i) => (
                      <Link key={i.title} href={i.href} className="fb-ask__item">
                        <span>{i.title}</span>
                        <small>{i.sub}</small>
                      </Link>
                    ))}
                  </div>
                ) : null}
                {m.draft !== undefined && m.draft !== "" ? (
                  <div className="fb-ask__draft">
                    <label className="fb-sr-only" htmlFor={`draft-${m.id}`}>
                      Draft message
                    </label>
                    <textarea id={`draft-${m.id}`} rows={4} value={m.draft} onChange={(e) => patch(m.id, { draft: e.target.value })} />
                    <span className="fb-ask__hint">Edit it, then copy it into your own message. Nothing is sent from here.</span>
                  </div>
                ) : null}
                {m.action && m.actionState !== "dismissed" ? (
                  <div className="fb-ask__card" data-state={m.actionState} role="group" aria-label="Proposed action">
                    <span className="fb-ask__eyebrow">{m.actionState === "confirmed" ? "DONE" : "WILL CREATE · NOTHING HAPPENS UNTIL YOU CONFIRM"}</span>
                    <strong>{m.action.title}</strong>
                    <span>
                      For {m.action.forWhom} · due {m.action.due}
                      {m.action.about ? ` · ${m.action.about}` : ""}
                    </span>
                    {m.actionError ? (
                      <span role="alert" className="fb-ask__hint">
                        {m.actionError}
                      </span>
                    ) : null}
                    {m.actionState === "confirmed" ? (
                      <span className="fb-ask__done">
                        <Check size={14} aria-hidden="true" /> Task created
                      </span>
                    ) : (
                      <span className="fb-ask__btns">
                        <button type="button" className="fb-ask__confirm" disabled={m.actionState === "confirming"} onClick={() => void confirm(m)}>
                          {m.actionState === "confirming" ? "Confirming…" : "Confirm"}
                        </button>
                        <button type="button" className="fb-ask__chip" disabled={m.actionState === "confirming"} onClick={() => void decline(m)}>
                          Not now
                        </button>
                      </span>
                    )}
                  </div>
                ) : null}
                {m.who === "ai" && !m.error ? (
                  <div className="fb-ask__foot">
                    <span>{m.basis}</span>
                    <button type="button" aria-label="Helpful" aria-pressed={m.feedback === "up"} onClick={() => rate(m, "up")}>
                      <ThumbsUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" aria-label="Not helpful" aria-pressed={m.feedback === "down"} onClick={() => rate(m, "down")}>
                      <ThumbsDown size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className="fb-ask__msg" data-who="ai" role="status">
                Looking at the records you can see…
              </div>
            ) : null}

            {thread.length === 0 ? (
              <div>
                <div className="fb-ask__try">Try asking</div>
                <div className="fb-ask__prompts">
                  {PROMPTS.map((p) => (
                    <button key={p} type="button" className="fb-ask__prompt" onClick={() => void ask(p)} disabled={atLimit}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div ref={end} />
          </div>

          <form
            className="fb-ask__form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >
            {atLimit ? (
              <p className="fb-ask__limit" role="status" data-testid="assistant-limit">
                You have used today’s {limit} questions. The limit resets tomorrow, or a Management member can raise it in Settings.
              </p>
            ) : null}
            <div className="fb-ask__row">
              <input ref={input} aria-label="Ask a question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your leads, deals, tasks…" disabled={atLimit} />
              <button type="submit" className="fb-ask__send" disabled={atLimit || busy || !text.trim()}>
                Ask
              </button>
            </div>
            <div className="fb-ask__hint">
              {limit !== null ? `${used} of ${limit} questions used today · ` : ""}I only suggest; you confirm every change.
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
