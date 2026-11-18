"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { describeError } from "../../errors";
import { useApiMutation } from "../../data/hooks";
import { useMember } from "../../data/member";
import { DealModal } from "../deals/Modal";

const CATEGORIES = [
  { value: "QUESTION", label: "A question" },
  { value: "PROBLEM", label: "Something is not working" },
  { value: "ACCESS", label: "Sign-in or access" },
  { value: "BILLING", label: "Billing or plan" },
  { value: "OTHER", label: "Something else" },
];

/**
 * Contact support (docs/SUPPORT_BY_EMAIL.md): any member asks Figbloom for help. The request is sent by email through Resend to
 * Figbloom support, with the member's own address as the Reply-To, so the answer arrives in their inbox. There is no ticket
 * list in the CRM: the platform console holds the tickets.
 */
/** Said in the dialog and on the confirmation. Not a promise in a contract: the figure Figbloom support aims for. */
export const SUPPORT_REPLY_TIME = "one working day";

export function ContactSupportDialog({ onClose }: { onClose: () => void }) {
  const { orgSlug, roleName } = useMember();
  const pathname = usePathname();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("QUESTION");
  const [message, setMessage] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ reference: string; sent: boolean } | null>(null);

  const send = useApiMutation("createSupportRequest", {
    onSuccess: (res) => setSent(res as { reference: string; sent: boolean }),
    onError: (e) => setError(describeError(e).body),
  });
  const ready = subject.trim().length > 0 && message.trim().length > 0;

  if (sent) {
    return (
      <DealModal
        title={sent.sent ? "Your request is on its way" : "Request recorded"}
        lead={sent.sent ? "Figbloom support has it. You will get the answer by email." : "Email delivery is not set up in this environment, so nothing was sent."}
        onClose={onClose}
        actions={
          <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" onClick={onClose}>
            Done
          </button>
        }
      >
        <p>
          Your reference is <strong data-testid="support-reference">{sent.reference}</strong>. Quote it if you write to us again about this.
        </p>
        <p>We usually reply by email within {SUPPORT_REPLY_TIME}.</p>
      </DealModal>
    );
  }

  return (
    <DealModal
      title="Contact support"
      lead={`We reply by email, to the address you sign in with, usually within ${SUPPORT_REPLY_TIME}. Please do not include passwords.`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fb-btn fb-btn--primary fb-dm__btn"
            disabled={send.isPending || !ready}
            onClick={() => {
              setError(null);
              send.mutate({ params: { orgSlug }, body: { subject: subject.trim(), message: message.trim(), category, urgency: urgent ? "URGENT" : "NORMAL", pagePath: pathname || undefined } });
            }}
          >
            {send.isPending ? "Sending…" : "Send request"}
          </button>
        </>
      }
    >
      <p className="fb-dm__context" data-testid="support-context">
        We send with your request: the page you are on ({pathname || "unknown"}), your role ({roleName}) and your organisation ({orgSlug}). Nothing else.
      </p>
      <label className="fb-dm__field">
        <span>What do you need help with?</span>
        <input className="fb-dm__input" value={subject} maxLength={160} onChange={(e) => setSubject(e.target.value)} required aria-required="true" />
      </label>
      <label className="fb-dm__field">
        <span>Kind of request</span>
        <select className="fb-dm__input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="fb-dm__field">
        <span>Tell us more</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={5} value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} required aria-required="true" />
      </label>
      <label className="fb-dm__field">
        <span>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> This is urgent: I cannot do my work
        </span>
      </label>
      {error ? (
        <p className="fb-dm__error" role="alert">
          {error}
        </p>
      ) : null}
    </DealModal>
  );
}
