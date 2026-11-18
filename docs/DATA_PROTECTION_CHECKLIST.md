# Data protection checklist: Kenya Data Protection Act, 2019 (P1.06, FIG-1128)

**This is an engineering checklist, not legal advice.** It maps what the product does to the obligations a team usually has to meet under the Kenya Data Protection Act, 2019 (the DPA) and its regulations, so that the right person can decide. Where a statement of law is needed (which lawful basis, whether a transfer is allowed, what the registration must say) it is marked **Lawyer**. Have a Kenyan data-protection lawyer or the Office of the Data Protection Commissioner (ODPC) confirm those points before go-live.

Date: 4 Nov 2026. Related: `docs/SECURITY_SIGNOFF_V1.md`, `docs/PRIVACY.md`, `docs/DATA_DELETION_REQUESTS.md`, `docs/TENANT_OFFBOARDING.md`. The data-location assessment for the chosen host is FIG-1258 (P1.14) and feeds section 6.

Who decides: **Given** (product and operations), **Michael** (approval), **Lawyer** (legal reading). **Eng** means the product already does it or the team can build it.

## 0. Roles to settle first (Lawyer)

The DPA distinguishes a data controller (decides why and how personal data is processed) from a data processor (processes on the controller's behalf). In this product the **subscriber organisation** (the customer using the CRM) is probably the controller of its contacts' data, and **FigBloom** is probably its processor; FigBloom is also a controller of its own users' account data (staff of the subscriber). During V1 the first organisation is FigBloom itself, so it is both. A lawyer must confirm this split, because it decides who registers, who signs which agreement and who answers data-subject requests.

## 1. Checklist

State: Done (the product does it), Partly, Open (a person must act), N/A.

| # | Obligation | What exists | State | Who |
|---|---|---|---|---|
| 1 | **Lawful basis and consent.** Each purpose has a lawful basis (consent, contract, legal obligation, legitimate interest) recorded | The product stores contacts, deals, communications and website-form leads. Website form: check the form shows a notice and, where consent is the basis, records it. Not verified in this pass | Open | Lawyer (choose basis per purpose); Eng (consent capture and notice on the website form if needed) |
| 2 | **Privacy notice** to data subjects (who we are, why, who receives it, rights, retention, how to complain) | No notice document in the repository | Open | Lawyer and Given |
| 3 | **Purpose limitation and data minimisation.** Only what the CRM needs | Fields are business contact and deal fields; deal values, margins, costs and payments are masked by role (`docs/MASKING.md`) | Partly | Given to confirm no unnecessary personal fields (for example identity numbers) are collected |
| 4 | **Retention.** A period per kind of data, enforced | Settings, Data and privacy: sign-in history 24 months, import files 90 days, export files 30 days, sync history 90 days, automation log 365 days, archived leads and tasks kept unless set; daily purge job; legal hold (`docs/PRIVACY.md`). **Contacts, companies, deals, invoices and payments are not purged by time**, only on erasure or organisation deletion | Partly | Given and Lawyer to set a retention period for contacts and financial records (tax law retention) and for the audit log (never purged) |
| 5 | **Right of access** | `POST /privacy/requests` kind ACCESS, `fulfil-access` produces one CSV of everything held about the person, short-lived link, due in 30 days by default | Done | Eng; Given runs the process |
| 6 | **Right to rectification** | Request kind RECTIFICATION, corrections go through the audited contact update | Done | Eng |
| 7 | **Right to erasure** | Request kind ERASURE, two different Management members confirm, erases the contact and linked records and stored files, scrubs audit and merge snapshots (rows stay, content erased), records `data_subject.erased` with counts and salted hashes; `scripts/erase-data-subject.ts` runs the same service. Invoices and payments stay (legal retention); free text elsewhere that mentions the person is flagged for a human to review. Blocked while a legal hold is on | Done, with a manual step | Eng; Given for the free-text review |
| 8 | **Right to object, restrict processing, data portability** | Portability: the access CSV and organisation export (`scripts/export-organization.ts`). No product feature to restrict or object (a person can be archived, which is not the same) | Partly | Lawyer to say whether a manual process is enough; Given to document it |
| 9 | **Response time** | 30 days default due date; overdue requests are flagged in the list. The DPA says "without undue delay"; confirm the exact period in the regulations | Done in product | Lawyer to confirm the period |
| 10 | **Request intake and identity verification** | Step 1 of `docs/DATA_DELETION_REQUESTS.md` (verify the requester, log the date outside the system) | Partly | Given: name the mailbox or form that receives requests |
| 11 | **Organisation-level requests** (export or delete a whole tenant) | Recorded and audited; carried out by the platform with two-person approval (V1.1); offboarding and export scripts exist (`docs/TENANT_OFFBOARDING.md`) | Partly | Given |
| 12 | **Security safeguards** (integrity and confidentiality) | See `docs/SECURITY_SIGNOFF_V1.md`: tenant isolation, role permissions, masking, hashed passwords (bcrypt 12), signed uploads, headers, rate limits, audit log, encrypted transport in production. Encryption at rest depends on the host | Partly | Eng done; Given for host settings (section 6); independent penetration test is open |
| 13 | **Malware scanning of uploads** | Built; needs `CLAMD_HOST` in production | Open | Given |
| 14 | **Breach notification.** Notify the ODPC and affected people within the legal period (the DPA sets 72 hours for the ODPC; confirm) | Incident runbook written (`docs/RUNBOOKS.md` section 8, including the 72-hour decision step added 5 Nov 2026). Audit log, sign-in history and error reporting give the evidence | Open | Given writes the runbook (who decides, who calls, templates); Lawyer confirms the period and content |
| 15 | **Processor agreements.** A written contract with every processor that handles personal data, and a check of its safeguards | None signed. Candidates are listed in section 4 | Open | Given and Lawyer |
| 16 | **Registration with the Data Commissioner.** Controllers and processors registering under the DPA and the Registration of Data Controllers and Data Processors Regulations | Not done. Whether FigBloom must register, as which role, and the fee depends on the legal reading and thresholds | Open | Lawyer decides; Given files; Michael approves. Do this before real customer data |
| 17 | **Data protection impact assessment** (high-risk processing; large scale or sensitive data) | Not done. Probably not triggered by a business CRM; a lawyer should say | Open | Lawyer |
| 18 | **Data protection officer / contact person** | Not named | Open | Given and Michael (a named contact for requests and the ODPC) |
| 19 | **Cross-border transfer.** Personal data stored or processed outside Kenya needs a legal ground and safeguards (adequate protection, appropriate safeguards or consent, and the regulations' rules on local processing for some data) | Production is plain PostgreSQL, **local for now, AWS later; the region is not chosen yet.** Today's data would be on a computer in Kenya; an AWS region outside Kenya, a mail or monitoring provider, or Sentry outside Kenya would each be a transfer | Open (depends on region) | See section 6. Lawyer; FIG-1258 |
| 20 | **Children's and sensitive data** | The CRM does not intend to collect either. Nothing prevents a user typing it into a free-text field | Partly | Given: add a rule to the user guide |
| 21 | **Records of processing** | Template in section 5 | Open | Given fills; Lawyer reviews |
| 22 | **Staff training and access control** | Roles limit access; every change is audited; Management only can export in bulk and approve erasure | Partly | Given: a short training note for Management |
| 23 | **Dev and test data.** No real customer data in dev, test or staging | Seeds are synthetic; staging refresh is guarded and anonymised (`docs/STAGING.md`) | Done | Eng; check at each refresh |

## 2. Data-subject request map

| Request | Where in the product | Evidence it leaves |
|---|---|---|
| Access | Settings > Data and privacy > requests > fulfil access | audit event, one CSV with a short-lived link |
| Rectification | Edit the contact, then record the request | audit event with field names only |
| Erasure | Settings > Data and privacy > requests > confirm erasure by two Management members; `scripts/erase-data-subject.ts` (dry run first) | `data_subject.erased` with counts and salted hash |
| Whole-organisation export or deletion | `POST /privacy/organisation-requests`, `scripts/export-organization.ts`, `scripts/offboard-organization.ts` | audit event; the platform team carries it out |
| Hold (do not delete or purge) | Legal hold with a reason | audit event |

## 3. What only a person can do

- **Lawyer:** lawful bases, controller and processor roles, notice wording, retention periods for business and tax records, breach periods, cross-border position, whether a DPIA is needed, registration category.
- **Given:** fill the record of processing, name the request mailbox and contact person, write the breach runbook, sign processor agreements, file the registration, decide retention periods, set up the antivirus host.
- **Michael:** approve the registration, the retention periods and the accepted risks; sign the security sign-off.

## 4. Processors and recipients (fill in; the team must confirm each)

| Provider or recipient | Purpose | Personal data involved | Location | Agreement signed (date) | Notes |
|---|---|---|---|---|---|
| Database host (this computer now; AWS later) | Stores all CRM data | All | This computer (the checklist records Kenya); AWS region provisional, `docs/DATA_LOCATION_ASSESSMENT.md` | None needed while self-hosted; AWS data processing addendum before the move | Self-hosted, no processor today (assessment finding L-01) |
| Object storage for uploaded files (local now; AWS later) | Attachments, imports, exports | Files and their content | This computer (SeaweedFS, private bucket) | None needed while self-hosted | Same move as the database |
| Mail sending provider (production choice not made; staging uses a sandbox only) | Notifications and invites | Names, email addresses, message content | | | |
| Error monitoring (Sentry, optional) | Error reports | Technical data, possibly user ids | No project yet | Needed if Sentry is used | Scrubbing is built in (`src/lib/sentryScrub.ts`); confirm before enabling |
| Antivirus host | Scans uploads | File content | This computer (staging); production host not chosen | None if self-hosted | Self-hosted ClamAV keeps content in-house; production refuses to start without `CLAMD_HOST` |
| Hosting, CDN or backup provider | Delivery and backups | All, encrypted or not | Backups: this computer's volume; off-site storage not chosen | None yet | Backups are not encrypted and not off-site yet (assessment finding L-03) |
| Linear and other internal tools | Project management | Must hold no customer data (CLAUDE.md rule 11) | | | Check no customer data is pasted |

## 5. Record of processing (the team fills this in)

One row per purpose. The examples show the level of detail; replace them after the lawyer has chosen the lawful basis.

| Purpose | Categories of people | Categories of data | Lawful basis (Lawyer) | Recipients and processors | Transfer outside Kenya | Retention | Security measures | Owner |
|---|---|---|---|---|---|---|---|---|
| Managing leads and customers | Leads, customer contacts | Name, email, phone, role, company, notes, communications | (to decide) | Section 4 | (to decide) | (to decide; contacts are kept until erasure) | Roles, masking, audit, tenant isolation | |
| Quotes, deals and payments | Customer contacts, billing contacts | Deal values, invoices, payments | (to decide) | | | (tax retention, to decide) | Payments visible to Finance and Management only | |
| Staff accounts and sign-in | Subscriber staff | Name, email, password hash, sign-in history, session data | (to decide) | | | Sign-in history 24 months by default | bcrypt, rate limits, session cookie flags | |
| Website lead form | Website visitors | Name, email, phone, message | (to decide; consent notice) | | | (to decide) | Per-organisation key, rate limit | |
| Audit log | Staff and contacts referenced | User ids, actions, ids and counts | (to decide) | | | Never purged by the product | Append-only at database level | |
| | | | | | | | | |

## 6. Cross-border transfer and data location (production on AWS)

Open until the region is chosen. Today the data is on a local PostgreSQL and the question does not arise for storage; it arises again when production moves to AWS, and for any provider in section 4.

1. Choose the AWS region deliberately; record the choice and the reason in `docs/DECISIONS.md` (Given and Michael). If no AWS region in Kenya or on the continent is acceptable to the lawyer, a transfer ground and safeguards are needed before the move.
2. List every provider that receives personal data and where it processes it (section 4).
3. Lawyer says whether the transfer needs a ground (adequacy, safeguards, consent) and whether any category must stay in Kenya.
4. Record the result in the record of processing and in the processor agreement (data location clause, sub-processors, deletion at end).
5. Check encryption at rest and in transit, backup location and access logging on the chosen host (security sign-off finding S-05).

## 7. Go-live gate for data protection

Before real customer data is loaded, at minimum: roles settled (section 0), registration decided and filed or formally not required (row 16), processor agreements for each provider in use (row 15), a named contact (row 18), a breach runbook (row 14), retention periods agreed (row 4), `CLAMD_HOST` set (row 13), and this checklist reviewed by the lawyer.

| Reviewed by | Name | Date | Notes |
|---|---|---|---|
| Lawyer | | | |
| Michael | | | |
| Given | | | |
