import { notFound } from "next/navigation";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { SignClient } from "./SignClient";
import { demoSigningFor } from "./demoSigning";

/**
 * The client's signing page (Q2, FIG-1193): open from the link in the quote email, no account. Runs on demo tokens (`demo-unsigned`, `demo-signed`,
 * `demo-deposit`) until B7.04 issues real signing links; an unknown token is a plain "link not valid" page that says nothing about any organisation.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  if (!demoScreensEnabled()) notFound();
  const { token } = await params;
  return <SignClient quote={demoSigningFor(token)} />;
}
