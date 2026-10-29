"use client";

import { Check, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DemoBadge } from "@/ui/demo/DemoBadge";
import { demoRespond } from "./demo/respond";
import { DAILY_LIMIT, type AskContext, type AssistantMessage, type ProposedAction, type Respond } from "./types";

const PROMPTS = ["Which proposals have no reply after a week?", "Show Hot leads with no task", "What’s overdue?", "What’s my open pipeline worth?"];

function usedToday(): number {
  try {
    return Number(localStorage.getItem(`figbloom-demo-ask-count:${new Date().toISOString().slice(0, 10)}`) ?? "0") || 0;
  } catch {
    return 0;
  }
}
function countOne(n: number) {
  try {
    localStorage.setItem(`figbloom-demo-ask-count:${new Date().toISOString().slice(0, 10)}`, String(n));
  } catch {
    /* the counter just restarts */
  }
}

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  /** The organisation's switch (Settings, AI assistant). Off: the panel explains and offers nothing. */
  enabled: boolean;
  ctx: AskContext;
  respond?: Respond;
  /** Runs the confirmed action. Nothing calls this until the person presses Confirm. */
  onConfirmAction?: (action: ProposedAction) => void | Promise<void>;
  settingsHref?: string;
  limit?: number;
}

/**
 * Ask Figbloom (X2, FIG-1171): a panel beside the page. It answers questions about records the person can open, drafts messages for them to edit
 * and send themselves, and proposes actions as cards. An action runs only when the person presses Confirm on its card; a card that is not
 * confirmed does nothing. When the organisation switches the assistant off the panel says so and shows no input.
 */
export function AssistantPanel({ open, onClose, enabled, ctx, respond = demoRespond, onConfirmAction, settingsHref, limit = DAILY_LIMIT }: AssistantPanelProps) {
  const [thread, setThread] = useState<AssistantMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState(0);
  const lastQuestion = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => setUsed(usedToday()), []);
  useEffect(() => {
    if (open && enabled) input.current?.focus();
  }, [open, enabled]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [thread.length, busy]);

  if (!open) return null;

  const atLimit = used >= limit;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy || atLimit) return;
    lastQuestion.current = q;
    setText("");
    setBusy(true);
    try {
      const replies = await respond(q, ctx);
      setThread((t) => [...t.filter((m) => !m.error), ...replies]);
      const next = used + 1;
      setUsed(next);
      countOne(next);
    } catch {
      setThread((t) => [
        ...t.filter((m) => !m.error),
        { id: `e${Date.now()}`, who: "ai", error: true, text: "I couldn’t answer that just now. Nothing was changed. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, change: Partial<AssistantMessage>) => setThread((t) => t.map((m) => (m.id === id ? { ...m, ...change } : m)));

  async function confirm(m: AssistantMessage) {
    if (!m.action || m.actionState !== "pending") return;
    patch(m.id, { actionState: "confirmed" });
    try {
      await onConfirmAction?.(m.action);
    } catch {
      patch(m.id, { actionState: "pending" });
    }
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
            Sees what {ctx.roleName} can see · <DemoBadge />
          </span>
        </div>
        <button type="button" className="fb-ask__x" aria-label="Close Ask Figbloom" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {!enabled ? (
        <div className="fb-ask__off" role="status" data-testid="assistant-off">
          <strong>The assistant is switched off</strong> for your organisation. Nothing you type here is read or sent anywhere.
          {settingsHref ? (
            <>
              {" "}
              A Management member can turn it on in <a href={settingsHref}>Settings, AI assistant</a>.
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
                {m.error ? (
                  <button type="button" className="fb-ask__chip" onClick={() => void ask(lastQuestion.current)}>
                    Try again
                  </button>
                ) : null}
                {m.items?.length ? (
                  <div className="fb-ask__items">
                    {m.items.map((i) => (
                      <a key={i.title} href={i.href} className="fb-ask__item">
                        <span>{i.title}</span>
                        <small>{i.sub}</small>
                      </a>
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
                      For {m.action.forWhom} · due {m.action.due} · {m.action.about}
                    </span>
                    {m.actionState === "confirmed" ? (
                      <span className="fb-ask__done">
                        <Check size={14} aria-hidden="true" /> Task created
                      </span>
                    ) : (
                      <span className="fb-ask__btns">
                        <button type="button" className="fb-ask__confirm" onClick={() => void confirm(m)}>
                          Confirm
                        </button>
                        <button type="button" className="fb-ask__chip" onClick={() => patch(m.id, { actionState: "dismissed" })}>
                          Not now
                        </button>
                      </span>
                    )}
                  </div>
                ) : null}
                {m.who === "ai" && !m.error ? (
                  <div className="fb-ask__foot">
                    <span>{m.basis}</span>
                    <button type="button" aria-label="Helpful" aria-pressed={m.feedback === "up"} onClick={() => patch(m.id, { feedback: "up" })}>
                      <ThumbsUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" aria-label="Not helpful" aria-pressed={m.feedback === "down"} onClick={() => patch(m.id, { feedback: "down" })}>
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
              {used} of {limit} questions used today · I only suggest; you confirm every change.
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
