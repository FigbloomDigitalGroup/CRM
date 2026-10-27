"use client";

import { useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { useReference } from "./data";
import { ModalShell } from "./overlay";

/**
 * "Why was X lost?" (L3): a reason is required, a note is optional. The API refuses Lost without a reason, so the button waits for one;
 * the reasons are the organisation's own list, never a hard-coded one.
 */
export function LostDialog({ leadId, name, onClose, onDone }: { leadId: string; name: string; onClose: () => void; onDone: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const ref = useReference();
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    const lost = ref.statusByKey("LOST");
    if (!lost || !reasonId) return;
    setBusy(true);
    setError(null);
    try {
      await api.call("patchLeadsByLeadId", { params: { orgSlug, leadId }, body: { leadStatusId: lost.id, lostReasonId: reasonId } });
      if (note.trim()) {
        await api
          .call("postActivities", { body: { type: "NOTE", subject: "Marked lost", description: note.trim(), leadId }, params: { orgSlug }, idempotencyKey: newIdempotencyKey() })
          .catch(() => undefined);
      }
      toast.show({ message: `${name} marked lost` });
      onDone();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={`Why was ${name} lost?`}
      intro="A reason keeps the lost-reasons report honest. Pick one."
      onClose={onClose}
      label="Lost reason"
      footer={
        <>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--solid-danger" disabled={!reasonId || busy} onClick={confirm}>
            Mark lost
          </button>
        </>
      }
    >
      <div className="fb-ld-reasons" role="group" aria-label="Lost reason">
        {ref.lostReasons.map((r) => (
          <button key={r.id} type="button" className="fb-ld-reason" aria-pressed={reasonId === r.id} onClick={() => setReasonId(r.id)}>
            {r.name}
          </button>
        ))}
      </div>
      <textarea className="fb-ld-textarea" rows={2} aria-label="Note" placeholder="Anything worth remembering? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </ModalShell>
  );
}
