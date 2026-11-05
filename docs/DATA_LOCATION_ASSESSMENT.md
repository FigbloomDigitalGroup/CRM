# Data location and transfer assessment (FIG-1258, P1.14)

Kenya Data Protection Act, 2019 (the DPA). **This is an engineering assessment, not legal advice.** It states where data is, where it will be, what moves, what must be agreed, and what a lawyer still has to say. Companion documents: `docs/DATA_PROTECTION_CHECKLIST.md` (obligations, rows 15, 16 and 19; sections 4 to 6), `docs/BACKUP_RESTORE.md` (section 8, moving to AWS), `docs/CUTOVER_PLAN.md`, `docs/DECISIONS.md` (section 5 and 6.11). Status: written 5 Nov 2026, signed by Given the same day (section 8). Open legal items are listed in section 6.

## 1. Where the data is now

| Data | Where | Who can reach it | Processor involved |
|---|---|---|---|
| Database (all organisations, audit, settings) | Plain PostgreSQL on the computer that runs the CRM (Docker volume). Development and staging copies on the same computer | Whoever has the owner and application database passwords (secret store or `staging.env`, outside the repository) | None. Self-hosted |
| Uploaded files | S3-compatible object store (SeaweedFS) on the same computer, private bucket | The application only, through signed links (`docs/STORAGE.md`) | None. Self-hosted |
| Antivirus | ClamAV on the same computer (staging); production host not chosen | The application | None if self-hosted |
| Backups | A Docker volume on the same computer (nightly job, `docs/BACKUP_RESTORE.md`) | Same people as the database | None. **Not encrypted and not off-site yet** |
| Outgoing email | Staging: a local sandbox that keeps mail on the computer. Production mail provider: not chosen | The sandbox owner; a provider once chosen | A mail provider will be a processor |
| Error tracking (Sentry) | No project yet | Sentry staff, if used | Sentry would be a processor; scrubbing is built in (`src/lib/sentryScrub.ts`) |
| Project tools (Linear, chat) | Cloud | Staff | Hold no customer data by rule (CLAUDE.md rule 11) |

The checklist records the current location as Kenya. **No customer data has been loaded yet** (decision 6.2, cutover Path A: a fresh organisation); staging holds only invented data.

## 2. Where it will be

Production is plain PostgreSQL, local now and on AWS later (Michael, 4 Nov 2026). No vendor-specific database or storage service is used, so the move is a dump and restore, new connection strings and an object-store switch (`docs/BACKUP_RESTORE.md` section 8). The region is not yet chosen for good.

## 3. Options for the AWS region

| Option | For | Against | Open question for the lawyer |
|---|---|---|---|
| Africa (Cape Town), `af-south-1` | The nearest AWS region to Kenya; keeps data on the continent; low latency to Nairobi | Outside Kenya, so a transfer rule still applies; fewer AWS services than the large regions | Does storing outside Kenya need a transfer ground or safeguards, and does any category of data have to stay in Kenya? |
| Europe (Ireland or Frankfurt) | Most services; strong regulatory regime | Further away; outside Kenya and the continent | Same question; adequacy position of the destination |
| A host inside Kenya | Avoids the cross-border question | No AWS region in Kenya; a different provider means a different migration and no AWS | Whether the DPA's local-storage rules apply to this data at all |

**Provisional recommendation (decision 6.11):** `af-south-1`, subject to the lawyer's answer. Nothing in the product depends on the region, so the choice can change before the move.

## 4. What moves, and what each side must agree

1. **Personal data in the database and the object store**: contacts, deal and payment data, staff accounts, communications, audit (record of processing, section 5 of the checklist).
2. **Processor agreement**: with AWS, accepted when the AWS account exists (AWS publishes a data processing addendum; the account owner accepts it in the console). Needed before any production data is stored there. Also needed for a mail provider and for Sentry if used. **None exists today and none is needed while everything is self-hosted.**
3. **Sub-processors and location clause**: record where each provider processes and stores data, and that deletion happens at the end of the contract.
4. **Safeguards on the move itself**: encryption in transit (TLS) and at rest (volume and bucket encryption on AWS, encrypted backups), restricted database access, access logging, backup location in the same region unless the lawyer approves another (`docs/SECURITY_SIGNOFF_V1.md` finding S-05).
5. **Rollback of the move**: the old database stays read-only and untouched until sign-off; switching the connection strings back is the rollback (`docs/CUTOVER_PLAN.md` section 9).

## 5. Findings

| ID | Severity | Finding | State |
|---|---|---|---|
| L-01 | Medium | No processor agreement exists. Not needed while self-hosted; **required before production data goes on AWS or through a mail provider or Sentry** | Open, condition of the move |
| L-02 | Medium | The region is provisional (decision 6.11) and the lawyer has not answered the transfer question | Open |
| L-03 | Medium | Backups are on the same computer, unencrypted: a lost computer loses the data and its backups | Open: off-site, encrypted copy and two key holders needed (`docs/BACKUP_RESTORE.md` sections 6 and 9) |
| L-04 | Low | Registration with the Data Commissioner, contact person, privacy notice, retention periods and the record of processing's lawful basis are not settled (checklist rows 1, 2, 4, 16, 18, 21) | Open, owners named in the checklist |
| L-05 | Info | The nightly backup job did not exist when this issue was opened; built and tested 5 Nov 2026 | Closed |

**No open Urgent or High finding.** L-01 to L-04 are Medium or lower and are accepted by Given as open items in section 8; none blocks loading **invented** data, and all of L-01, L-02 and L-04 must be settled before **real customer data** is loaded (go-live gate, checklist section 7), which decision 6.12 does not waive.

## 6. What only a person (or the lawyer) can do

- Lawyer: lawful bases, controller and processor roles, whether the transfer to the chosen region needs a ground, whether any data must stay in Kenya, registration, whether a DPIA is needed, wording of the privacy notice and the processor agreement.
- Given and Michael: choose the region for good, create the AWS account under a company login, accept the processor agreement, name the contact person, file the registration, agree retention periods.
- Given: provide off-site backup storage and name two key holders.

## 7. How this ties to the cutover plan

Cutover Path A (a fresh organisation) loads no existing data, so the move to production has nothing to carry across. The plan, rehearsals, rollback proof and timed restore drill are in `docs/CUTOVER_PLAN.md` and `docs/BACKUP_RESTORE.md`.

## 8. Sign-off

| Role | Name | Decision | Accepted findings | Date | Record |
|---|---|---|---|---|---|
| Product owner | Given | Approve with accepted items | L-01 to L-04 | 5 Nov 2026 | Recorded by Claude on Given's written instruction in the session of 5 Nov 2026; no handwritten signature |
| Team lead | Michael | Not recorded | | | Michael's approval of this assessment is not recorded |
| Lawyer | | Not yet reviewed | | | Required before real customer data (checklist section 7) |
