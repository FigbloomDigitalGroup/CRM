import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { limitQuoteSign } from "@/auth/publicLimits";
import { getSigningPage } from "@/services/quoteSignatureService";
import { LiveSign, type SignState } from "./LiveSign";

export const dynamic = "force-dynamic";

/**
 * Public quote signing (FIG-1186, B7.04, design Q2). The link in the email carries a secret token; there is no sign-in. An address that is
 * not a signable link (unknown, revoked, replaced, or an organisation below release V2) gets the plain "not available" 404 (not-found.tsx
 * beside this file), so V1 and V1.1 organisations show nothing new. An expired link is explained on the page.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await limitQuoteSign(getClientIp(new Request("http://localhost/", { headers: await headers() })));
  const result = await getSigningPage(token);
  if (result.status === "not_found") notFound();
  const state: SignState =
    result.status === "expired"
      ? result
      : result.status === "signed"
        ? { status: "signed", page: result.page, signature: { ...result.signature, signedAt: result.signature.signedAt.toISOString() } }
        : { status: "ok", page: result.page };
  return <LiveSign token={token} state={state} />;
}
