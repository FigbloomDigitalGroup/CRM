import { FigbloomLoader } from "@/ui/components/loader";

/** Shown while an organisation's workspace opens (its shell and session load): the Orbit loader over the whole screen. */
export default function Loading() {
  return <FigbloomLoader fullScreen label="Getting things ready" />;
}
