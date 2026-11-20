# `adminDb` on tenant data: classification (UC-F4, audit S-1)

A **snapshot** written by `npx tsx scripts/adminDb-allowlist.ts --write` (it carries no personal data, only file names, model names and counts). The binding, always-current list is `config/adminDbAllowList.json`, enforced by `tests/adminDbAllowList.test.ts`. The rule is in [ADMINDB_RULE.md](ADMINDB_RULE.md).

`adminDb` is the schema-owner Prisma client: row-level security (RLS) does not apply to it, so a query on tenant data through it is safe only while its own `where` names the organisation. UC-F5 moves the tenant-data sites to `withOrgContext`.

## Totals

- Files under `src/` that import `adminDb`: **132**. Files that use it (outside `src/db/adminClient.ts`): **132**.
- Uses found: **754** (719 model calls, 14 raw SQL calls, 14 places where `adminDb` is passed or assigned, 7 where a transaction client is passed on). The audit's "about 95 call sites" counted the services that hit tenant models; this counts every call.
- Schema: **114** tenant models (they carry `organizationId`, plus the organisation itself) and **21** global models (users, sessions, roles, platform tables, ...). Uses of global models are not tenant data and are not listed.
- Uses on tenant data (including raw SQL on tenant tables and the UNKNOWN markers below): **669** in **121** files.

| Category | Meaning | Uses on tenant data |
|---|---|---|
| identity | sign-in, session, two-step, membership and organisation lookups | 72 uses in 21 files |
| bootstrap | organisation provisioning, reference data, lifecycle | 18 uses in 4 files |
| platform | platform console, support access, health probe | 52 uses in 6 files |
| cron-claim | background jobs and sweeps that find work across organisations | 13 uses in 5 files |
| **tenant-data** | business records read or written on the owner connection: UC-F5 migrates these | **514 uses in 85 files** |

The first four are **allowed**. The classification is by file and deliberately narrow: a file that mixes a legitimate lookup with business-record access is counted as `tenant-data` (UC-F5 splits it). A category was assigned from the file's purpose and a read of its calls, not by running it; **UNKNOWN** is stated where the code could not tell.

## Tenant-data uses by area

| Area | Files | Uses |
|---|---|---|
| services | 75 | 500 |
| repositories | 4 | 7 |
| other (lib, automations, sequences, notifications) | 5 | 6 |
| app (routes and pages) | 1 | 1 |

## Review first: writes with no organisation in the filter

75 `update`, `updateMany`, `delete`, `deleteMany` or `upsert` calls on tenant models, in `tenant-data` files, whose `where` does not name the organisation (`none`) or could not be read (`unknown`). Many follow an earlier organisation-scoped fetch of the same row and are fine today; each is a cross-tenant write if a refactor drops that fetch. This is a hint for the reviewer, not a verdict.

| Where | Call | Filter |
|---|---|---|
| `src/services/approvalService.ts:604` | `dataSubjectRequest.update` | none |
| `src/services/assistantService.ts:254` | `assistantRequest.update` | none |
| `src/services/assistantService.ts:284` | `assistantRequest.update` | none |
| `src/services/assistantService.ts:355` | `assistantProposal.updateMany` | none |
| `src/services/assistantService.ts:360` | `assistantProposal.update` | none |
| `src/services/assistantService.ts:364` | `assistantProposal.update` | none |
| `src/services/assistantService.ts:374` | `assistantProposal.updateMany` | none |
| `src/services/cardCaptureService.ts:102` | `cardCapture.update` | none |
| `src/services/cardCaptureService.ts:140` | `cardCapture.updateMany` | none |
| `src/services/cardCaptureService.ts:156` | `cardCapture.update` | none |
| `src/services/cardCaptureService.ts:161` | `cardCapture.update` | none |
| `src/services/cardCaptureService.ts:173` | `cardCapture.update` | none |
| `src/services/cardCaptureService.ts:187` | `cardCapture.updateMany` | none |
| `src/services/cardCaptureService.ts:199` | `cardCapture.update` | none |
| `src/services/chatPrivacyService.ts:36` | `file.update` | none |
| `src/services/churnHintService.ts:136` | `churnHint.update` | none |
| `src/services/churnHintService.ts:275` | `churnHint.update` | none |
| `src/services/churnHintService.ts:294` | `churnHint.update` | none |
| `src/services/conversationService.ts:441` | `lead.update` | none |
| `src/services/fileService.ts:455` | `file.updateMany` | none |
| `src/services/fileService.ts:477` | `file.update` | none |
| `src/services/mailService.ts:318` | `mailDraft.update` | none |
| `src/services/mailService.ts:338` | `mailDraft.delete` | none |
| `src/services/mailService.ts:348` | `mailDraft.updateMany` | none |
| `src/services/mailService.ts:367` | `mailDraft.update` | none |
| `src/services/mailService.ts:405` | `mailDraft.update` | none |
| `src/services/mailService.ts:456` | `mailDraft.update` | none |
| `src/services/mailService.ts:465` | `mailDraft.updateMany` | none |
| `src/services/mailService.ts:479` | `mailDraft.update` | none |
| `src/services/meetingService.ts:130` | `activity.delete` | none |
| `src/services/meetingService.ts:137` | `activity.delete` | none |
| `src/services/meetingService.ts:211` | `activity.update` | none |
| `src/services/meetingService.ts:212` | `calendarEventLink.update` | none |
| `src/services/meetingService.ts:225` | `activity.update` | none |
| `src/services/meetingService.ts:226` | `calendarEventLink.update` | none |
| `src/services/meetingService.ts:306` | `calendarEventLink.update` | none |
| `src/services/meetingService.ts:319` | `calendarEventLink.update` | none |
| `src/services/meetingService.ts:345` | `calendarEventLink.update` | none |
| `src/services/meetingService.ts:353` | `calendarEventLink.update` | none |
| `src/services/migrationEngine.ts:238` | `importSession.update` | none |
| `src/services/migrationEngine.ts:399` | `importSession.update` | none |
| `src/services/migrationEngine.ts:432` | `importSession.update` | none |
| `src/services/migrationEngine.ts:448` | `importSession.update` | none |
| `src/services/migrationEngine.ts:464` | `importSession.update` | none |
| `src/services/migrationEngine.ts:497` | `importSession.update` | none |
| `src/services/migrationEngine.ts:693` | `importSession.update` | none |
| `src/services/migrationService.ts:278` | `importSession.update` | none |
| `src/services/migrationService.ts:378` | `importSession.update` | none |
| `src/services/migrationService.ts:407` | `importSession.update` | none |
| `src/services/migrationService.ts:464` | `importSession.update` | none |
| `src/services/migrationService.ts:492` | `importSession.update` | none |
| `src/services/migrationService.ts:496` | `importSession.update` | none |
| `src/services/migrationService.ts:537` | `importMappingPreset.update` | none |
| `src/services/migrationService.ts:566` | `importMappingPreset.delete` | none |
| `src/services/oauthConnectionService.ts:171` | `oAuthState.updateMany` | none |
| `src/services/oauthConnectionService.ts:207` | `oAuthConnection.update` | none |
| `src/services/oauthConnectionService.ts:302` | `oAuthConnection.update` | none |
| `src/services/oauthConnectionService.ts:323` | `oAuthConnection.update` | none |
| `src/services/oauthConnectionService.ts:340` | `oAuthConnection.update` | none |
| `src/services/oauthConnectionService.ts:389` | `oAuthConnection.update` | none |
| `src/services/oauthConnectionService.ts:407` | `oAuthConnection.update` | none |
| `src/services/privacyService.ts:203` | `exportApproval.update` | none |
| `src/services/privacyService.ts:311` | `dataSubjectRequest.update` | none |
| `src/services/privacyService.ts:321` | `dataSubjectRequest.update` | none |
| `src/services/privacyService.ts:379` | `dataSubjectRequest.update` | none |
| `src/services/privacyService.ts:408` | `dataSubjectRequest.update` | none |
| `src/services/privacyService.ts:428` | `dataSubjectRequest.update` | none |
| `src/services/privacyService.ts:440` | `dataSubjectRequest.update` | none |
| `src/services/privacyService.ts:497` | `file.update` | none |
| `src/services/quickCaptureService.ts:236` | `contact.update` | none |
| `src/services/quickCaptureService.ts:265` | `contact.delete` | none |
| `src/services/quickCaptureService.ts:271` | `lead.update` | none |
| `src/services/quoteService.ts:373` | `stageRule.upsert` | none |
| `src/services/roleEditorService.ts:316` | `role.update` | none |
| `src/services/roleEditorService.ts:357` | `role.update` | none |

## Reads with no organisation in the filter

28 reads on tenant models in `tenant-data` files whose `where` is an object literal that does not name the organisation (for example a lookup by `id` after a scoped fetch, or a global key). Per file, with the line of each call:

- `src/services/migrationRows.ts` (11): leadStatus.findMany:84, leadSource.findMany:85, service.findMany:86, pipelineStage.findMany:87, customerLifecycleState.findMany:88, membership.findMany:89, lostReason.findMany:94, company.findMany:126, contact.findMany:134, lead.findMany:143, deal.findMany:147
- `src/services/meetingService.ts` (3): calendarEventLink.findUnique:250, calendarEventLink.findFirst:336, calendarEventLink.findMany:348
- `src/services/oauthConnectionService.ts` (2): oAuthState.findUnique:168, oAuthState.findUnique:229
- `src/services/taskBackfill.ts` (2): activity.findMany:26, lead.findMany:58
- `src/lib/apiErrors.ts` (1): role.findUnique:122
- `src/repositories/quoteShares.ts` (1): quoteShare.findUnique:42
- `src/repositories/webForms.ts` (1): webForm.findUnique:66
- `src/services/approvalService.ts` (1): exportApproval.count:333
- `src/services/fileService.ts` (1): file.findMany:463
- `src/services/handoffService.ts` (1): membership.findFirst:690
- `src/services/mailService.ts` (1): mailDraft.findUniqueOrThrow:349
- `src/services/migrationEngine.ts` (1): importSession.findUnique:259
- `src/services/privacyService.ts` (1): contact.findUniqueOrThrow:407
- `src/services/websiteLeadService.ts` (1): organization.findUnique:91

## UNKNOWN: places the scanner cannot follow

21 places where `adminDb` (or a transaction client) is passed to another function or stored, so the models used by the callee are not visible here, and 3 raw SQL calls whose tables could not be read. They are counted under `$adminDb-escape`, `$tx-escape` and `$raw-unreadable` in the allow-list and need a person to read them in UC-F5:

- `src/auth/twoStep/stores.ts:18` (escape)
- `src/services/approvalService.ts:242` (escape)
- `src/services/approvalService.ts:243` (escape)
- `src/services/emailTemplateService.ts:181` (escape)
- `src/services/organizationLifecycleService.ts:104` (tx-escape)
- `src/services/platformDataRequestService.ts:159` (escape)
- `src/services/platformDataRequestService.ts:190` (escape)
- `src/services/platformDataRequestService.ts:312` (escape)
- `src/services/platformDataRequestService.ts:333` (tx-escape)
- `src/services/platformDataRequestService.ts:431` (escape)
- `src/services/platformDataRequestService.ts:435` (escape)
- `src/services/platformDataRequestService.ts:446` (escape)
- `src/services/platformDataRequestService.ts:462` (escape)
- `src/services/platformDataRequestService.ts:524` (tx-escape)
- `src/services/platformDataRequestService.ts:530` (tx-escape)
- `src/services/platformDataRequestService.ts:600` (tx-escape)
- `src/services/platformFlagsService.ts:174` (tx-escape)
- `src/services/platformFlagsService.ts:188` (tx-escape)
- `src/services/platformOrganizationService.ts:312` (escape)
- `src/services/privacyService.ts:224` (escape)
- `src/services/supportAccessService.ts:662` (escape)
- `src/app/api/health/route.ts:32` (raw SQL, tables unreadable)
- `src/services/platformDataRequestService.ts:382` (raw SQL, tables unreadable)
- `src/services/platformDataRequestService.ts:494` (raw SQL, tables unreadable)

## Reviewed by hand: `src/services/churnHintService.ts` (named in FIG-1768)

The issue asked whether the raw SQL near line 92 (the activity counts per customer) has an organisation filter. **It does, and no cross-tenant gap was found.** Read in full on 20 Nov 2026:

- The raw query filters `c.organization_id = <organisation>` and `c.id IN (<ids>)`; both joins are tied to the same organisation (`a.organization_id = c.organization_id`, `ct.organization_id = c.organization_id`). The ids come from an earlier `company.findMany` that also filters by organisation.
- Every other read, and `resolveGone`'s `updateMany`, names the organisation in its `where`.
- **Fragile, not broken:** three writes use a bare id, `churnHint.update({ where: { id } })` at the refresh (an id from the organisation-filtered `open` list) and in `dismissChurnHint` and `rateChurnHint` (both after `loadVisibleHint`, which filters by `ctx.organizationId`). They are safe only because of that earlier lookup; a refactor that drops it becomes a cross-tenant write. UC-F5 should move this service to `withOrgContext`, or make those updates `updateMany` with the organisation in the filter.
- The existing test `tests/churnHints.test.ts` ("tenant isolation") proves that another organisation's list, dismiss and feedback return nothing or NotFound. It does not prove that the nightly refresh of one organisation leaves another's hints alone; by the code it does, and no test was added in this issue (no behaviour change here).

## Every file, by category

### identity (21 files)

- `src/repositories/memberships.ts`: 22 (membership, organization, role, roleFieldRule, signInEvent) _Hand-checked and fine in the audit (S-1)._
- `src/auth/session.ts`: 8 (membership, session)
- `src/services/twoStepService.ts`: 7 (membership, organizationSetting)
- `src/services/signInEventService.ts`: 6 (membership, signInEvent)
- `src/services/sessionService.ts`: 4 (session)
- `src/services/organizationSwitcherService.ts`: 3 (membership, organization, session)
- `src/auth/apiToken.ts`: 2 (apiToken, membership)
- `src/auth/inboundEmailKey.ts`: 2 (inboundEmailKey, organization)
- `src/auth/requestContext.ts`: 2 (membership, organization)
- `src/auth/sessionPolicy.ts`: 2 (organizationSetting)
- `src/auth/websiteApiKey.ts`: 2 (organization, websiteApiKey)
- `src/repositories/organizations.ts`: 2 (organization)
- `src/services/authService.ts`: 2 (organization)
- `src/auth/inboundBccAddress.ts`: 1 (organization)
- `src/auth/platformIdentity.ts`: 1 (auditEvent)
- `src/auth/twoStep/stores.ts`: 1 ($adminDb-escape)
- `src/repositories/roles.ts`: 1 (role)
- `src/services/accessStateService.ts`: 1 (membership)
- `src/services/authAudit.ts`: 1 (membership)
- `src/services/meContextService.ts`: 1 (role)
- `src/services/membershipService.ts`: 1 (membership)

### bootstrap (4 files)

- `src/services/organizationDefaults.ts`: 9 (customFieldDefinition, customerLifecycleState, leadSource, leadStatus, lostReason, organizationSetting, pipelineStage, service)
- `src/services/referenceDataService.ts`: 6 (customerLifecycleState, leadSource, leadStatus, lostReason, pipelineStage, service)
- `src/services/organizationLifecycleService.ts`: 2 ($tx-escape, organizationLifecycleEvent)
- `src/services/organizationProvisioningService.ts`: 1 (role)

### platform (6 files)

- `src/services/platformDataRequestService.ts`: 41 ($adminDb-escape, $raw-unreadable, $tx-escape, file, membership, organization, organizationLifecycleEvent, platformDataRequest, platformDeletionCertificate)
- `src/services/platformFlagsService.ts`: 4 ($tx-escape, organizationSetting)
- `src/services/supportAccessService.ts`: 4 ($adminDb-escape, membership, organization, supportAccessGrant) _Hand-checked and fine in the audit (S-1)._
- `src/app/api/health/route.ts`: 1 ($raw-unreadable) _Health probe: `SELECT 1` only._
- `src/services/platformOrganizationService.ts`: 1 ($adminDb-escape)
- `src/services/platformPreferenceService.ts`: 1 (auditEvent)

### cron-claim (5 files)

- `src/repositories/backgroundJobs.ts`: 6 (backgroundJob)
- `src/jobs/runner.ts`: 3 (backgroundJob, organization)
- `src/repositories/scheduledJobRuns.ts`: 2 (backgroundJob)
- `src/observability/jobQueue.ts`: 1 (backgroundJob)
- `src/services/notificationSweepService.ts`: 1 (organization)

### tenant-data (85 files)

- `src/services/privacyService.ts`: 39 ($adminDb-escape, activity, attachment, automationRun, communication, contact, dataSubjectRequest, deal, exportApproval, file, importSession, lead, role, signInEvent, syncMutation, task)
- `src/services/meetingService.ts`: 29 (activity, calendarEventLink, contact, deal, lead, oAuthConnection, task)
- `src/services/migrationService.ts`: 27 (customFieldDefinition, file, importMappingPreset, importSession, importSessionIssue, membership)
- `src/services/oauthConnectionService.ts`: 21 (membership, oAuthConnection, oAuthState, organization)
- `src/services/approvalService.ts`: 20 ($adminDb-escape, company, dataSubjectRequest, exportApproval, membership, organization, pipelineStage)
- `src/services/assistantService.ts`: 20 (assistantProposal, assistantRequest, membership, organizationSetting)
- `src/services/handoffService.ts`: 18 (company, companyService, customerLifecycleState, membership, organizationSetting, task)
- `src/services/mailService.ts`: 18 (communication, company, mailDraft, membership, oAuthConnection)
- `src/services/migrationEngine.ts`: 17 (file, importSession, importSessionChange, importSessionIssue, membership)
- `src/services/churnHintService.ts`: 16 (activity, churnHint, company, contact, membership, organizationSetting, recurringService)
- `src/services/quickCaptureService.ts`: 15 (company, contact, lead, leadSource, leadStatus, service)
- `src/services/migrationRows.ts`: 13 (company, contact, customerLifecycleState, deal, lead, leadSource, leadStatus, lostReason, membership, organization, pipelineStage, service, tag)
- `src/services/quoteDocumentService.ts`: 13 (contact, deal, file, membership, organization, quoteEvent, quoteVersion)
- `src/services/roleEditorService.ts`: 12 (membership, role, roleFieldRule)
- `src/services/auditLogService.ts`: 11 (company, contact, deal, invoice, lead, membership, organization, recurringService, task)
- `src/services/cardCaptureService.ts`: 11 (cardCapture, file)
- `src/services/dealRuleService.ts`: 11 (lostReason, organizationSetting, pipeline, pipelineStage)
- `src/services/importService.ts`: 10 (company, contact, customerLifecycleState, leadSource, leadStatus, membership, service)
- `src/services/reminderService.ts`: 10 (company, companyService, organization, organizationSetting, proposalReference, recurringService)
- `src/services/quoteService.ts`: 9 (deal, organizationSetting, pipelineStage, stageRule)
- `src/services/leadService.ts`: 7 (company, contact, leadSource, leadStatus, membership, service)
- `src/services/quoteSignatureService.ts`: 7 (deal, organization, quoteEvent, quoteVersion)
- `src/services/teamActivityNotifier.ts`: 7 (company, contact, membership, organization)
- `src/services/erasureService.ts`: 6 (attachment, auditEvent, contact, mergeRecord)
- `src/services/integrationRegistryService.ts`: 6 (communication, inboundEmailKey, organization, organizationSetting, websiteApiKey)
- `src/services/orgLimitService.ts`: 6 (file, membership, organizationSetting, organizationUsageCounter)
- `src/services/chatPrivacyService.ts`: 5 (attachment, chatMessageAttachment, file, membership)
- `src/services/leadPoolService.ts`: 5 (leadPoolRequest, membership, organizationSetting)
- `src/services/paymentService.ts`: 5 (invoice, membership, organization, paymentRecord)
- `src/services/activityService.ts`: 4 (deal, lead)
- `src/services/commentService.ts`: 4 (membership, organization)
- `src/services/fileService.ts`: 4 (attachment, file)
- `src/services/leadIntakeService.ts`: 4 (company, contact, leadStatus)
- `src/services/notificationService.ts`: 4 (membership, organization, organizationSetting)
- `src/services/ownerEligibility.ts`: 4 (membership)
- `src/services/pipelineService.ts`: 4 (customFieldDefinition, deal, service)
- `src/services/quickLogService.ts`: 4 (company, contact, lead)
- `src/services/taskBackfill.ts`: 4 (activity, lead, task)
- `src/repositories/webForms.ts`: 3 (organization, webForm)
- `src/services/chatService.ts`: 3 (membership, notification, organization)
- `src/services/conversationService.ts`: 3 (lead, leadSource, leadStatus)
- `src/services/dataRunService.ts`: 3 (file, membership)
- `src/services/dealService.ts`: 3 (membership, pipelineStage)
- `src/services/featureService.ts`: 3 (organizationSetting)
- `src/services/integrationService.ts`: 3 (organization, organizationSetting)
- `src/services/organizationProfileService.ts`: 3 (organization)
- `src/services/recurringServiceService.ts`: 3 (membership, organizationSetting, service)
- `src/services/stalledDealAlerts.ts`: 3 (deal, organization, pipelineStage)
- `src/services/websiteLeadAssignmentRuleService.ts`: 3 (leadSource, membership, service)
- `src/lib/apiErrors.ts`: 2 (membership, role)
- `src/repositories/websiteLeadRequestLog.ts`: 2 (websiteApiKey, websiteLeadRequestLog)
- `src/services/approvalGateService.ts`: 2 (deal)
- `src/services/approvalRuleService.ts`: 2 (organizationSetting)
- `src/services/customerReportService.ts`: 2 (organizationSetting)
- `src/services/dealStageGate.ts`: 2 (pipelineStage)
- `src/services/emailTemplateService.ts`: 2 ($adminDb-escape, membership)
- `src/services/exportService.ts`: 2 (customerLifecycleState, service)
- `src/services/leadKeyNoteService.ts`: 2 (lead, membership)
- `src/services/organizationLookService.ts`: 2 (organization)
- `src/services/privacySettings.ts`: 2 (organizationSetting)
- `src/services/pwaService.ts`: 2 (organization)
- `src/services/reassignmentService.ts`: 2 (membership)
- `src/services/scoreEngine.ts`: 2 (organizationSetting)
- `src/services/signalService.ts`: 2 (membership, pipelineStage)
- `src/app/api/orgs/[orgSlug]/deals/route.ts`: 1 (pipelineStage)
- `src/automations/runLog.ts`: 1 (membership)
- `src/lib/featureConfig.ts`: 1 (organizationSetting)
- `src/notifications/webPush.ts`: 1 (membership)
- `src/repositories/followUps.ts`: 1 (membership)
- `src/repositories/quoteShares.ts`: 1 (quoteShare)
- `src/sequences/engine.ts`: 1 (contact)
- `src/services/automationService.ts`: 1 (organizationSetting)
- `src/services/communicationService.ts`: 1 (activity)
- `src/services/companyService.ts`: 1 (customerLifecycleState)
- `src/services/customFieldService.ts`: 1 (service)
- `src/services/dashboardService.ts`: 1 (membership)
- `src/services/directoryService.ts`: 1 (customerLifecycleState)
- `src/services/notificationCentreService.ts`: 1 (membership)
- `src/services/notificationDeliveryPolicy.ts`: 1 (membership)
- `src/services/profileService.ts`: 1 (organization)
- `src/services/qualificationService.ts`: 1 (leadStatus)
- `src/services/renewalSettings.ts`: 1 (organizationSetting)
- `src/services/supportRequestService.ts`: 1 (organization)
- `src/services/syncService.ts`: 1 (pipelineStage)
- `src/services/websiteLeadService.ts`: 1 (organization)

