"use client";

import { useState } from "react";
import { Button, Checkbox, Dialog, Input } from "@/ui";

/** "What the client sees" (Q2 demo) from inside the builder: name, agreement, sign. The real client page is /sign/{token} (FIG-1193). */
export function SignPreviewDialog({
  open,
  onClose,
  quoteNo,
  total,
  defaultName,
  onSign,
}: {
  open: boolean;
  onClose: () => void;
  quoteNo: string;
  total: string;
  defaultName: string;
  onSign: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Sign quote ${quoteNo} · ${total}`}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !agree} onClick={() => onSign(name.trim())}>Sign and accept</Button>
        </>
      }
    >
      <p className="fb-com-eyebrow">What the client sees</p>
      <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <p className="fb-com-doc__sig" aria-hidden="true">{name}</p>
      <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label="I agree to the scope, prices and terms in this quote." />
    </Dialog>
  );
}
