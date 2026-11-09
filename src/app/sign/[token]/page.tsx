import { notFound } from "next/navigation";

/**
 * Public quote signing (FIG-1193) is V2 and is not part of the first release: no signing link is issued, so every address under /sign/ gets the same
 * plain "not available" page (see not-found.tsx beside this file), with a real 404 status. It reads nothing, names no organisation and carries no
 * sample data. The signing screen returns with V2.
 */
export default function SignPage() {
  notFound();
}
