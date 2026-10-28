"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { Icon } from "../leads/icons";
import { ModalShell } from "../leads/overlay";
import { dialLinks } from "./data";

/**
 * The post-call and post-WhatsApp prompt (C3, FIG-1096, B3.08). Tapping Call or WhatsApp on a record opens the phone or WhatsApp; when the person
 * comes back to this tab the prompt asks "How did it go?" and one request (`quickLog`) saves the timeline entry, the conversation, "last contacted"
 * (only when someone was reached) and an optional follow-up task. It takes two taps: the outcome, then Log it.
 *
 * Reusable: any screen calls `useCallLogPrompt()`, renders `element` once, and gives `begin` to its reach buttons (`ReachButtons`). The mobile
 * screens (M9) and Customer 360 use the same pieces.
 */

export type LogChannel = "CALL" | "WHATSAPP";
export type LogOutcome = "REACHED" | "NO_ANSWER" | "LEFT_MESSAGE";

/** Who the conversation was with. Exactly one id, as the API requires. */
export interface LogTarget {
  contactId?: string;
  leadId?: string;
  companyId?: string;
  dealId?: string;
  /** What the prompt calls them ("Chebet"). */
  name: string;
}

const OUTCOMES: { value: LogOutcome; label: string }[] = [
  { value: "REACHED", label: "Reached" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "LEFT_MESSAGE", label: "Left a message" },
];

const PENDING_KEY = "figbloom-pending-quick-log";
const PENDING_MAX_AGE_MS = 30 * 60_000;
/** If the tab never loses focus (a desktop with no phone app) the prompt still comes up after this long, so the call can be logged. */
export const FALLBACK_PROMPT_MS = 2500;

interface Pending {
  target: LogTarget;
  channel: LogChannel;
  at: number;
}

function readPending(): Pending | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return Date.now() - p.at < PENDING_MAX_AGE_MS ? p : null;
  } catch {
    return null;
  }
}
function writePending(p: Pending | null) {
  try {
    if (p) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* blocked storage: the prompt still works while the page stays open */
  }
}

export function useCallLogPrompt(): { begin: (target: LogTarget, channel: LogChannel) => void; element: ReactNode; isOpen: boolean } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState<Pending | null>(null);

  // A phone browser may unload this page while the call app is in front; coming back reloads it, and the prompt is still owed.
  useEffect(() => {
    const stored = readPending();
    if (stored) {
      writePending(null);
      setOpen(stored);
    }
  }, []);

  const begin = useCallback((target: LogTarget, channel: LogChannel) => {
    const p = { target, channel, at: Date.now() };
    writePending(p);
    setPending(p);
  }, []);

  useEffect(() => {
    if (!pending) return;
    let left = document.visibilityState === "hidden";
    const show = () => {
      writePending(null);
      setPending(null);
      setOpen(pending);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left = true;
      else if (left) show();
    };
    const onBlur = () => {
      left = true;
    };
    const onFocus = () => {
      if (left) show();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    const timer = window.setTimeout(() => {
      if (!left) show();
    }, FALLBACK_PROMPT_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer);
    };
  }, [pending]);

  const element = open ? <QuickLogPrompt target={open.target} channel={open.channel} onClose={() => setOpen(null)} /> : null;
  return { begin, element, isOpen: Boolean(open) };
}

/** The "How did it go?" dialog. Skip closes it without logging anything. */
export function QuickLogPrompt({ target, channel, onClose, onLogged }: { target: LogTarget; channel: LogChannel; onClose: () => void; onLogged?: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<LogOutcome | null>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key for this prompt: a double tap, or a retry after a dropped connection, logs once.
  const key = useRef(newIdempotencyKey());

  const who = target.contactId ? { contactId: target.contactId } : target.leadId ? { leadId: target.leadId } : target.companyId ? { companyId: target.companyId } : { dealId: target.dealId };
  const promptQ = useApiQuery("getQuickLogPrompt", { params: { orgSlug }, query: who as never }, { staleTime: 60_000 });
  const number = promptQ.data?.telHref?.replace(/^tel:/, "") ?? null;
  const kind = channel === "WHATSAPP" ? "WhatsApp" : "Call";

  async function save() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      await api.call("quickLog", {
        params: { orgSlug },
        idempotencyKey: key.current,
        body: {
          channel,
          outcome,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(next.trim() ? { followUp: { title: next.trim(), dueOn: tomorrow } } : {}),
          ...who,
        } as never,
      });
      toast.show({ message: `${kind} with ${target.name} logged${next.trim() ? ". Follow-up task added" : ""}` });
      for (const id of ["listContactDirectory", "getContactsByContactId", "getActivities", "getCommunications", "getTasks", "listConversations", "getLeadsByLeadId", "getCompaniesByCompanyId"]) void qc.invalidateQueries({ queryKey: [id] });
      onLogged?.();
      onClose();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="How did it go?"
      intro="Log it now, while you remember. It takes a few seconds."
      onClose={onClose}
      label="Log prompt"
      eyebrow={
        <span className="fb-ct-eyebrow">
          <Icon name={channel === "WHATSAPP" ? "whatsapp" : "phone"} size={14} />
          {kind} with {target.name}
        </span>
      }
      footer={
        <>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
            Skip
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--lg" disabled={!outcome || busy} onClick={save}>
            {busy ? "Logging…" : "Log it"}
          </button>
        </>
      }
    >
      <div className="fb-ct-prompt">
        {number ? <div className="fb-ct-prompt__number">{number}</div> : null}
        <div className="fb-ct-chips" role="group" aria-label="Outcome">
          {OUTCOMES.map((o) => (
            <button key={o.value} type="button" className="fb-ct-chip" aria-pressed={outcome === o.value} onClick={() => setOutcome(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <textarea className="fb-ld-textarea" rows={2} aria-label="What happened" placeholder="One line is enough." value={note} onChange={(e) => setNote(e.target.value)} />
        <input className="fb-ld-input" aria-label="Next action" placeholder="Next action (optional)" value={next} onChange={(e) => setNext(e.target.value)} />
        {error ? (
          <div role="alert" className="fb-ct-prompt__error">
            {error}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}

/**
 * Call and WhatsApp for one person: links that open the phone or WhatsApp, then start the log prompt. Nothing renders without a number, so
 * a record with no phone never offers a dead button. `variant` is the design's three sizes: list row, card row and the wide buttons on a page.
 */
export function ReachButtons({
  name,
  phone,
  target,
  begin,
  variant = "row",
  firstName,
}: {
  name: string;
  phone: string | null | undefined;
  target: LogTarget;
  begin: (target: LogTarget, channel: LogChannel) => void;
  variant?: "row" | "card" | "wide";
  firstName?: string;
}) {
  const links = dialLinks(phone);
  if (!links) return null;
  const callRef = target;
  if (variant === "wide") {
    return (
      <>
        <a className="fb-ct-wide fb-ct-wide--primary" href={links.tel} onClick={() => begin(callRef, "CALL")}>
          <Icon name="phone" size={18} />
          Call {firstName ?? name}
        </a>
        <a className="fb-ct-wide" href={links.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => begin(callRef, "WHATSAPP")}>
          <Icon name="whatsapp" size={18} />
          Open WhatsApp
        </a>
      </>
    );
  }
  const size = variant === "row" ? 15 : 14;
  return (
    <span className={`fb-ct-reach fb-ct-reach--${variant}`}>
      <a className="fb-ct-reach__btn" href={links.tel} title="Call" aria-label={`Call ${name}`} onClick={() => begin(callRef, "CALL")}>
        <Icon name="phone" size={size} />
      </a>
      <a className="fb-ct-reach__btn" href={links.whatsapp} target="_blank" rel="noopener noreferrer" title="Open WhatsApp" aria-label={`WhatsApp ${name}`} onClick={() => begin(callRef, "WHATSAPP")}>
        <Icon name="whatsapp" size={size} />
      </a>
    </span>
  );
}
