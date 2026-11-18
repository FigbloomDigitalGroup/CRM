import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `quote_signatures` (FIG-1186). Every call runs in the organisation's RLS context. The table is append-only (a trigger). */

export class AlreadySignedError extends Error {
  constructor() {
    super("This quote version has already been answered.");
    this.name = "AlreadySignedError";
  }
}

/**
 * Records the signature and moves the version SENT -> ACCEPTED in one transaction, so a signature never exists without the
 * acceptance. The signature goes first (the database accepts one only for a SENT version, and the table has a unique version, so two
 * people signing at once cannot both win: the second waits for the first and then fails the unique check). The conditional update
 * that follows claims the version; if it does not match, the whole transaction is rolled back.
 */
export function recordSignatureAndAccept(organizationId: string, data: Prisma.QuoteSignatureUncheckedCreateInput, decisionReason: string) {
  return withOrgContext(organizationId, async (tx) => {
    let created;
    try {
      created = await tx.quoteSignature.create({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AlreadySignedError();
      // Two people signing at once: the second reaches the database guard after the first has made the version ACCEPTED.
      if (err instanceof Error && err.message.includes("can be signed only while it is SENT")) throw new AlreadySignedError();
      throw err;
    }
    const claimed = await tx.quoteVersion.updateMany({
      where: { id: data.quoteVersionId, organizationId, status: "SENT" },
      data: { status: "ACCEPTED", respondedAt: data.signedAt, decisionReason },
    });
    if (claimed.count !== 1) throw new AlreadySignedError();
    return created;
  });
}

export function findSignatureForVersion(organizationId: string, quoteVersionId: string) {
  return withOrgContext(organizationId, (tx) => tx.quoteSignature.findFirst({ where: { organizationId, quoteVersionId } }));
}

export function listSignaturesForQuote(organizationId: string, quoteId: string) {
  return withOrgContext(organizationId, (tx) => tx.quoteSignature.findMany({ where: { organizationId, quoteId }, orderBy: { signedAt: "asc" } }));
}
