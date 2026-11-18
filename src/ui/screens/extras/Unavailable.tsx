"use client";

import { describeError } from "../../errors";
import { Icon } from "../leads/icons";

/** A part of the panel the API would not give this person: said in words, in place, never a silent gap. */
export function Unavailable({ what, error, noun }: { what: string; error: unknown; noun: string }) {
  const d = describeError(error);
  const text =
    d.kind === "noAccess" || d.kind === "notFound"
      ? `${what} aren’t available to your role on this ${noun}.`
      : `${what} could not be loaded. ${d.body}`;
  return (
    <p className="fb-xnote" role="status">
      <Icon name="lock" size={13} />
      {text}
    </p>
  );
}
