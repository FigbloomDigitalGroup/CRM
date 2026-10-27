import type { Prisma } from "@prisma/client";

/**
 * A list that searches a related record's text (a lead by its company's name or its contact's name) used to ask Prisma for a relation
 * filter inside an OR, which Prisma writes as LEFT JOINs that no index can serve: 200 ms over 50,000 leads (G1.04). Looking the related
 * records up first, by their own trigram indexes, and filtering by id is the same result for a fraction of the time.
 *
 * Only when more records than `CAP` match (a search for one letter-pair in a big directory) does it return null and the caller keeps the
 * relation filter, so the answer and its count stay exact either way.
 */
const CAP = 500;

export async function companyIdsNamed(tx: Prisma.TransactionClient, organizationId: string, text: string): Promise<string[] | null> {
  const rows = await tx.company.findMany({
    where: { organizationId, name: { contains: text, mode: "insensitive" } },
    select: { id: true },
    take: CAP + 1,
  });
  return rows.length > CAP ? null : rows.map((r) => r.id);
}

export async function contactIdsNamed(tx: Prisma.TransactionClient, organizationId: string, text: string): Promise<string[] | null> {
  const rows = await tx.contact.findMany({
    where: {
      organizationId,
      OR: [
        { firstName: { contains: text, mode: "insensitive" } },
        { lastName: { contains: text, mode: "insensitive" } },
        { email: { contains: text, mode: "insensitive" } },
      ],
    },
    select: { id: true },
    take: CAP + 1,
  });
  return rows.length > CAP ? null : rows.map((r) => r.id);
}
