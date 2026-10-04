/**
 * GDPR / Kenya Data Protection Act (DPA)-style "right to erasure" --
 * execution step (FIG-601). This is deliberately a standalone admin
 * script, not a web route or a button anywhere in the product: a real
 * erasure request needs identity verification and a legal-basis check
 * that happen entirely outside this codebase (see
 * docs/DATA_DELETION_REQUESTS.md for the full request-handling process
 * this script is the final step of).
 *
 * Scope: Contact only, never Company. A Contact is a natural person --
 * the actual "data subject" GDPR/the DPA concerns. A Company is a
 * business entity, not personal data, so it's out of scope here (the doc
 * covers the rare sole-trader edge case). Deleting a Company is also
 * blocked at the database level whenever it still has a Deal
 * (`Deal.companyId` is a required, `ON DELETE RESTRICT` column) --
 * deliberately, since Deal/financial records usually need to be retained
 * for a different legal reason than the one that justifies erasing a
 * person's contact details.
 *
 * What this deletes: the Contact row itself, and everything that
 * `ON DELETE CASCADE`s from it -- its Activities, Tasks, and
 * Communications (see the Contact model in prisma/schema.prisma). What
 * it does NOT delete: any Lead/Deal that referenced this contact -- those
 * foreign keys are `ON DELETE SET NULL`, so the Lead/Deal itself survives
 * (it's this organization's own business record, not the data subject's),
 * just with the contact link cleared.
 *
 * What this does NOT do: scrub this person's name/details out of
 * free-text fields on OTHER records (a Lead's or Deal's `notes`, for
 * example) that might still mention them. Reliably de-identifying
 * unstructured text is a manual-review step, not something this script
 * can do safely -- see the doc for how to handle that.
 *
 * Runs through the same org-scoped, RLS-enforced connection as the
 * running application (`withOrgContext`), not the schema-owner
 * connection -- this script's only privilege over a normal request is
 * that nobody is logged in; the delete itself goes through the exact
 * same guardrails.
 *
 * Usage (dry run by default -- nothing is deleted without --confirm):
 *   tsx scripts/erase-data-subject.ts --org <slug> --contact <id>
 *   tsx scripts/erase-data-subject.ts --org <slug> --contact <id> --confirm
 */
import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { recordAuditEvent } from "../src/repositories/auditEvents";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    orgSlug: get("--org"),
    contactId: get("--contact"),
    confirm: argv.includes("--confirm"),
  };
}

async function main(): Promise<void> {
  const { orgSlug, contactId, confirm } = parseArgs(process.argv.slice(2));
  if (!orgSlug || !contactId) {
    console.error(
      "Usage: tsx scripts/erase-data-subject.ts --org <slug> --contact <id> [--confirm]",
    );
    process.exitCode = 1;
    return;
  }

  const org = await adminDb.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    throw new Error(`No organization with slug "${orgSlug}".`);
  }

  await withOrgContext(org.id, async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, organizationId: org.id },
    });
    if (!contact) {
      throw new Error(`No contact ${contactId} in organization "${orgSlug}".`);
    }

    const [leads, deals, activities, tasks, communications] = await Promise.all([
      tx.lead.count({ where: { organizationId: org.id, contactId } }),
      tx.deal.count({ where: { organizationId: org.id, primaryContactId: contactId } }),
      tx.activity.count({ where: { organizationId: org.id, contactId } }),
      tx.task.count({ where: { organizationId: org.id, contactId } }),
      tx.communication.count({ where: { organizationId: org.id, contactId } }),
    ]);

    console.log(
      `Contact: ${contact.firstName} ${contact.lastName ?? ""} <${contact.email ?? "no email"}>`,
    );
    console.log(
      `Will DELETE (cascades from this contact): ${activities} activities, ${tasks} tasks, ${communications} communications.`,
    );
    console.log(
      `Will UNLINK, not delete (contactId cleared, record kept): ${leads} leads, ${deals} deals.`,
    );

    if (!confirm) {
      console.log("\nDry run only -- re-run with --confirm to actually erase.");
      return;
    }

    // Recorded before the delete, not after -- it needs the contact's own
    // details to be a useful processing record, and `entityId` pointing at
    // a now-deleted row is fine (AuditEvent.entityType/entityId are plain
    // strings, no FK -- see prisma/schema.prisma).
    await recordAuditEvent({
      organizationId: org.id,
      action: "data_subject.erased",
      entityType: "Contact",
      entityId: contact.id,
      metadata: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        unlinkedLeads: leads,
        unlinkedDeals: deals,
      },
    });

    await tx.contact.delete({ where: { id: contact.id } });
    console.log(`Erased contact ${contactId}.`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
