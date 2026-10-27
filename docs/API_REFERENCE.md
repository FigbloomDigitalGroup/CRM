# Figbloom CRM API reference (v1.0.0)

Generated from the OpenAPI document by `npm run contract:update`; do not edit by hand. The document is `src/api/contract/openapi.v1.json`,
the typed client is `src/api-client/`, and `npm run mock:api` serves every operation below without a database.
Conventions (error envelope, paging, idempotency): `docs/API_CONVENTIONS.md`. Changes since 1.0: `docs/API_CHANGELOG.md`.

**Access** lists the roles the permission matrix lets through (`docs/PERMISSION_MATRIX_REPORT.md`); any other role gets a 403 with an explained denial.
Operations marked *derived* have their request schema recorded from the route itself; their answers are described by shape, not by a hand-written schema.

## Contents

- [Activities](#activities) (2)
- [Attachments](#attachments) (3)
- [Audit](#audit) (4)
- [Auth](#auth) (6)
- [Automations](#automations) (4)
- [Calendar](#calendar) (2)
- [Comments](#comments) (4)
- [Communications](#communications) (3)
- [Companies](#companies) (22)
- [Company Services](#company-services) (3)
- [Contacts](#contacts) (20)
- [Conversations](#conversations) (9)
- [Custom Fields](#custom-fields) (4)
- [Customer 360](#customer-360) (1)
- [Dashboard](#dashboard) (3)
- [Data and privacy](#data-and-privacy) (18)
- [Data migration](#data-migration) (17)
- [Deal Moves](#deal-moves) (1)
- [Deal Rules](#deal-rules) (2)
- [Deals](#deals) (26)
- [Duplicates](#duplicates) (1)
- [Email Templates](#email-templates) (5)
- [Features](#features) (2)
- [Files](#files) (8)
- [Handoff Settings](#handoff-settings) (2)
- [Handoffs](#handoffs) (1)
- [Import and export](#import-and-export) (5)
- [Imports](#imports) (1)
- [Integrations](#integrations) (16)
- [Jobs](#jobs) (5)
- [Lead Pool](#lead-pool) (5)
- [Leads](#leads) (23)
- [Lifecycle](#lifecycle) (3)
- [Me](#me) (5)
- [Memberships](#memberships) (10)
- [Merges](#merges) (1)
- [My Work](#my-work) (1)
- [Notification Preferences](#notification-preferences) (2)
- [Notifications](#notifications) (8)
- [Operations](#operations) (5)
- [Organisation](#organisation) (2)
- [PWA](#pwa) (2)
- [Payments](#payments) (14)
- [Preferences](#preferences) (4)
- [Profile](#profile) (6)
- [Public](#public) (2)
- [Push](#push) (4)
- [Quick capture](#quick-capture) (1)
- [Reference Catalogs](#reference-catalogs) (4)
- [Reference Data](#reference-data) (1)
- [Reference data](#reference-data) (8)
- [Reminders](#reminders) (2)
- [Renewals](#renewals) (10)
- [Reports](#reports) (15)
- [Scoring](#scoring) (2)
- [Search](#search) (4)
- [Security](#security) (3)
- [Session](#session) (2)
- [Settings](#settings) (1)
- [Sync](#sync) (2)
- [Tags](#tags) (5)
- [Tasks](#tasks) (15)
- [Website Lead Assignment Rules](#website-lead-assignment-rules) (4)

## Activities

### `GET …/activities`

`getActivities` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Query:** `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/activities`

`postActivities` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `type`: "CALL" | "MEETING" | "NOTE" | "EMAIL" | "WHATSAPP" | "OTHER", `subject`?: string, `description`?: string, `occurredAt`?: any, `outcome`?: string, `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string
- **Returns:** `id`: string, `organizationId`: string, `type`: string, `subject`: string, `description`: string, `occurredAt`: string, `outcome`: string, `authorMembershipId`: string, `companyId`: string, `contactId`: string, `leadId`: string, `dealId`: string, `createdAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

## Attachments

### `DELETE …/attachments/{attachmentId}`

`deleteAttachmentsByAttachmentId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `id`: string
- **Errors:** 401, 403, 404

### `POST …/attachments/{attachmentId}/complete`

`postAttachmentsByAttachmentIdComplete` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `id`: string, `organizationId`: string, `fileId`: string, `companyId`?: null, `contactId`?: null, `leadId`: string, `dealId`?: null, `taskId`?: null, `proposalReferenceId`?: null, `title`?: null, `shared`: boolean, `uploadedByMembershipId`: string, `createdAt`: string, `deletedAt`?: null, `file`: object
- **Errors:** 401, 404

### `GET …/attachments/{attachmentId}/download`

`getAttachmentsByAttachmentIdDownload` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `download`: object, `file`: object
- **Errors:** 401, 403, 404

## Audit

### `GET …/audit`

`getAudit` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** object[]
- **Errors:** 401, 403, 404

### `GET …/audit/events`

`listAuditLog`

Organisation-wide audit log: filter by actor, entity type, action (prefix with *) and dates; each row links to its record; payment entities only for readers who may see payments (audit.view)

- **Credential:** sessionCookie; **access:** management
- **Query:** `actorMembershipId`?: string, `entityType`?: string, `entityId`?: string, `action`?: string, `dateFrom`?: string, `dateTo`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401, 403

### `GET …/audit/events/export`

`exportAuditLog`

The audit events the filters show, as CSV. Exporting the log is itself audited.

- **Credential:** sessionCookie; **access:** management
- **Query:** `actorMembershipId`?: string, `entityType`?: string, `entityId`?: string, `action`?: string, `dateFrom`?: string, `dateTo`?: string
- **Returns:** string
- **Errors:** 400, 401, 403

### `GET …/audit/filters`

`getAuditLogFilters`

What the filter controls offer: entity types, actions, the people who acted

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403

## Auth

### `POST /api/auth/accept-invite`

`acceptInvite`

Accept an organisation invite with its token (and choose a password when the person has none yet).

- **Credential:** none (public)
- **Body:** `token`: string, `password`?: string
- **Returns:** object
- **Errors:** 400, 401, 429

### `POST /api/auth/login`

`login` · rate limited

Sign in with email and password. Every failure is the same generic 401; repeated attempts are rate limited.

- **Credential:** none (public)
- **Body:** `email`: string, `password`: string
- **Returns:** object
- **Errors:** 400, 401, 429

### `POST /api/auth/logout`

`logout`

End the current session and clear the cookie.

- **Credential:** sessionCookie
- **Returns:** `ok`?: boolean

### `POST /api/auth/password-reset/confirm`

`confirmPasswordReset`

Set a new password with the emailed token.

- **Credential:** none (public)
- **Body:** `token`: string, `newPassword`: string
- **Returns:** `ok`?: boolean
- **Errors:** 400, 401, 429

### `POST /api/auth/password-reset/request`

`requestPasswordReset` · rate limited

Ask for a reset email. Always answers the same, whether or not the address has an account; rate limited.

- **Credential:** none (public)
- **Body:** `email`: string
- **Returns:** `ok`?: boolean
- **Errors:** 400, 429

### `POST /api/auth/signup`

`signup` · rate limited

Create an account and sign in. Grants no organisation access on its own.

- **Credential:** none (public)
- **Body:** `name`: string, `email`: string, `password`: string
- **Returns:** object
- **Errors:** 400, 409, 429

## Automations

### `GET …/automations`

`listAutomationRules`

The automation rules with switch, thresholds, audience and the last seven days of runs. Rules assign, remind and notify; they never decide. (Management)

- **Credential:** sessionCookie; **access:** management
- **Returns:** `items`: object[], `boundary`: string
- **Errors:** 401, 403

### `GET …/automations/{ruleKey}`

`getAutomationRule`

One rule

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403, 404

### `PATCH …/automations/{ruleKey}`

`updateAutomationRule`

Switch a rule on or off, change its thresholds or audience. Audited with before and after.

- **Credential:** sessionCookie; **access:** management
- **Body:** `enabled`?: boolean, `params`?: object, `audience`?: "OWNER" | "OWNER_AND_MANAGEMENT"
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `GET …/automations/runs`

`listAutomationRuns`

The run log: each run with its rule, record and result

- **Credential:** sessionCookie; **access:** management
- **Query:** `ruleKey`?: string, `status`?: string, `entityType`?: string, `entityId`?: string, `dateFrom`?: string, `dateTo`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401, 403

## Calendar

### `GET …/calendar`

`getCalendar` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Query:** `from`?: string, `to`?: string, `view`?: "month" | "week" | "day" | "list", `date`?: string, `membershipId`?: string
- **Returns:** `from`: string, `to`: string, `timeZone`: string, `view`: string, `truncated`: boolean, `teamFilter`: object, `selected`: string, `items`: any[]
- **Errors:** 400, 401, 404

### `POST …/calendar`

`postCalendar` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Body:** `kind`: "task" | "activity", `title`: string, `start`: string, `type`?: "CALL" | "MEETING", `description`?: string, `assigneeMembershipId`?: string, `link`?: object
- **Returns:** `kind`: string, `id`: string, `start`: string
- **Errors:** 400, 401, 403, 404

## Comments

### `PATCH …/comments/{commentId}`

`editComment`

Edit your own comment (soft: marked edited; only newly mentioned people are notified)

- **Credential:** sessionCookie; **access:** management
- **Body:** `body`: string, `mentions`?: string[]
- **Returns:** `id`: string, `authorName`: string | null, `body`: string | null, `deleted`: boolean, `edited`: boolean, `mentions`: string[], `canEdit`: boolean, `canDelete`: boolean, `createdAt`: string
- **Errors:** 400, 401, 403, 404, 409

### `DELETE …/comments/{commentId}`

`deleteCommentsByCommentId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `deleted`: boolean
- **Errors:** 401, 403, 404

### `GET …/leads/{leadId}/comments`

`listLeadComments`

Comments on a lead (the same endpoints exist for contacts, companies, deals and tasks)

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `comments`: object[], `following`: boolean
- **Errors:** 401, 404

### `POST …/leads/{leadId}/comments`

`addLeadComment`

Add a comment; `mentions` are member ids and only people who can open the record may be mentioned

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `body`: string, `mentions`?: string[]
- **Returns:** `id`: string, `authorName`: string | null, `body`: string | null, `deleted`: boolean, `edited`: boolean, `mentions`: string[], `canEdit`: boolean, `canDelete`: boolean, `createdAt`: string
- **Errors:** 400, 401, 404, 409

## Communications

### `GET …/communications`

`getCommunications` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** any[]
- **Errors:** 401, 403, 404

### `POST …/communications`

`postCommunications` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `channel`: "EMAIL" | "PHONE" | "WHATSAPP" | "SMS" | "MEETING" | "SOCIAL" | "OTHER", `direction`: "INBOUND" | "OUTBOUND", `occurredAt`?: any, `subject`?: string, `summary`: string, `externalReference`?: string, `activityId`?: string, `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/communications/send-email`

`postCommunicationsSendEmail` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `to`: string, `subject`: string, `body`: string, `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string, `templateId`?: string
- **Returns:** `id`: string, `organizationId`: string, `channel`: string, `direction`: string, `occurredAt`: string, `subject`: string, `summary`: string, `externalReference`?: null, `authorMembershipId`: string, `activityId`?: null, `emailTemplateId`: string, `companyId`: string, `contactId`: string, `leadId`: string, `dealId`: string, `needsLinking`: boolean, `counterpartyEmail`?: null, `counterpartyName`?: null, `counterpartyPhone`?: null, `durationSeconds`?: null, `linkedAt`?: null, `linkedByMembershipId`?: null, `dismissedAt`?: null, `dismissedByMembershipId`?: null, `dismissReason`?: null, `createdAt`: string
- **Errors:** 400, 401, 403, 404

## Companies

### `GET …/companies`

`getCompanies` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `tagId`?: string, `q`?: string, `ownerMembershipId`?: string, `includeArchived`?: "true" | "false", `archivedOnly`?: "true" | "false", `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/companies`

`postCompanies` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `customFields`?: object, `name`: string, `industry`?: string, `website`?: string, `location`?: string, `phone`?: string, `email`?: string, `notes`?: string, `lifecycleStateId`?: string, `ownerMembershipId`?: string
- **Returns:** `company`: object, `possibleDuplicates`: object[], `duplicates`: object[], `hiddenDuplicates`: number
- **Errors:** 400, 401, 403, 404

### `GET …/companies/{companyId}`

`getCompaniesByCompanyId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `industry`?: null, `website`?: null, `location`?: null, `phone`?: null, `email`: string, `notes`?: null, `lifecycleStateId`?: null, `ownerMembershipId`: string, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `healthValue`?: null, `healthBand`?: null, `healthFactors`?: null, `healthScoredAt`?: null, `lifecycleChangedAt`?: null, `lifecycleManual`: boolean, `mergedIntoId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `contacts`: object[], `lifecycleState`?: null, `owner`: object, `tags`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/companies/{companyId}`

`patchCompaniesByCompanyId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `customFields`?: object, `name`?: string, `industry`?: string, `website`?: string, `location`?: string, `phone`?: string, `email`?: string, `notes`?: string, `lifecycleStateId`?: string | null, `ownerMembershipId`?: string | null
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `industry`?: null, `website`?: null, `location`?: null, `phone`?: null, `email`: string, `notes`?: null, `lifecycleStateId`?: null, `ownerMembershipId`: string, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `healthValue`?: null, `healthBand`?: null, `healthFactors`?: null, `healthScoredAt`?: null, `lifecycleChangedAt`?: null, `lifecycleManual`: boolean, `mergedIntoId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/companies/{companyId}/archive`

`postCompaniesByCompanyIdArchive` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `reason`?: string
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `industry`?: null, `website`?: null, `location`?: null, `phone`?: null, `email`: string, `notes`?: null, `lifecycleStateId`?: null, `ownerMembershipId`: string, `createdByMembershipId`: string, `archivedAt`: string, `archivedByMembershipId`: string, `archiveReason`?: null, `customFields`: object, `healthValue`?: null, `healthBand`?: null, `healthFactors`?: null, `healthScoredAt`?: null, `lifecycleChangedAt`?: null, `lifecycleManual`: boolean, `mergedIntoId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `GET …/companies/{companyId}/attachments`

`getCompaniesByCompanyIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `items`: any[]
- **Errors:** 401, 403, 404

### `POST …/companies/{companyId}/attachments`

`postCompaniesByCompanyIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Body:** `name`: string, `mimeType`: string, `sizeBytes`: number, `checksumSha256`?: string, `title`?: string, `shared`?: boolean, `proposalReferenceId`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/companies/{companyId}/comments`

`getCompaniesByCompanyIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `comments`: any[], `following`: boolean
- **Errors:** 401, 403, 404

### `POST …/companies/{companyId}/comments`

`postCompaniesByCompanyIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `body`: string, `mentions`?: string[]
- **Returns:** `id`: string, `authorMembershipId`: string, `authorName`: string, `body`: string, `deleted`: boolean, `edited`: boolean, `editedAt`?: null, `createdAt`: string, `mentions`: any[], `canEdit`: boolean, `canDelete`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/companies/{companyId}/comments/mentionable`

`getCompaniesByCompanyIdCommentsMentionable` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `members`: object[]
- **Errors:** 401, 403, 404

### `POST …/companies/{companyId}/follow`

`postCompaniesByCompanyIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `DELETE …/companies/{companyId}/follow`

`deleteCompaniesByCompanyIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `GET …/companies/{companyId}/health`

`getCompaniesByCompanyIdHealth` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `score`: number, `band`: string, `factors`: object[], `computedAt`: string
- **Errors:** 401, 403, 404

### `POST …/companies/{companyId}/merge`

`postCompaniesByCompanyIdMerge` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `intoCompanyId`: string, `fields`?: object
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/companies/{companyId}/restore`

`postCompaniesByCompanyIdRestore` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/companies/{companyId}/tags`

`getCompaniesByCompanyIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `tags`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/companies/{companyId}/tags`

`patchCompaniesByCompanyIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `addTagIds`?: string[], `addTagNames`?: string[], `removeTagIds`?: string[]
- **Returns:** `tags`: any[]
- **Errors:** 400, 401, 403, 404

### `POST …/companies/check-duplicates`

`postCompaniesCheckDuplicates` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `name`?: string, `email`?: string, `phone`?: string
- **Returns:** `possibleDuplicates`: any[], `duplicates`: any[], `hiddenDuplicates`: number
- **Errors:** 400, 401, 403, 404

### `GET …/companies/directory`

`listCompanyDirectory`

Company list with tabs ALL (archived hidden), DORMANT and ARCHIVED, and filters for lifecycle, service, owner and tag. Each tab's count is what it would list.

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `tab`?: string, `q`?: string, `lifecycle`?: string, `serviceId`?: string, `ownerMembershipId`?: string, `tagId`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `tab`: string, `tabCounts`: object
- **Errors:** 400, 401, 403

### `GET …/companies/directory/export`

`exportCompanyDirectory`

CSV of one company tab with the same filters (companies.export; bulk-export rule)

- **Credential:** sessionCookie; **access:** management
- **Query:** `tab`?: string, `q`?: string, `lifecycle`?: string, `serviceId`?: string, `ownerMembershipId`?: string, `tagId`?: string
- **Returns:** string
- **Errors:** 400, 401, 403

### `GET …/companies/export`

`getCompaniesExport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** CSV
- **Errors:** 401, 403, 404

### `POST …/companies/import`

`postCompaniesImport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** multipart form with `file`
- **Returns:** `totalRows`: number, `created`: number, `duplicatesSkipped`: number, `alreadyConverted`: number, `failed`: number, `truncated`: boolean, `cancelled`: boolean, `errors`: object[]
- **Errors:** 400, 401, 403, 404

## Company Services

### `GET …/company-services`

`getCompanyServices` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** any[]
- **Errors:** 401, 403, 404

### `POST …/company-services`

`postCompanyServices` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `companyId`: string, `serviceId`: string, `status`?: "ACTIVE" | "COMPLETED" | "CANCELLED", `startDate`?: string, `endDate`?: string, `notes`?: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `serviceId`: string, `status`: string, `startDate`?: null, `endDate`?: null, `notes`?: null, `createdAt`: string, `updatedAt`: string, `service`: object
- **Errors:** 400, 401, 403, 404

### `POST …/company-services/{companyServiceId}`

`postCompanyServicesByCompanyServiceId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `status`?: "ACTIVE" | "COMPLETED" | "CANCELLED", `startDate`?: string | null, `endDate`?: string | null, `notes`?: string | null
- **Returns:** any
- **Errors:** 400, 401, 403, 404

## Contacts

### `GET …/contacts`

`getContacts` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `tagId`?: string, `q`?: string, `companyId`?: string, `ownerMembershipId`?: string, `includeArchived`?: "true" | "false", `archivedOnly`?: "true" | "false", `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/contacts`

`postContacts` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `customFields`?: object, `firstName`: string, `lastName`?: string, `companyId`?: string, `phone`?: string, `email`?: string, `jobTitle`?: string, `department`?: string, `notes`?: string, `ownerMembershipId`?: string
- **Returns:** `contact`: object, `possibleDuplicates`: any[], `duplicates`: any[], `hiddenDuplicates`: number
- **Errors:** 400, 401, 403, 404

### `GET …/contacts/{contactId}`

`getContactsByContactId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `firstName`: string, `lastName`: string, `phone`: string, `email`: string, `jobTitle`?: null, `department`?: null, `socialProfiles`?: null, `notes`?: null, `ownerMembershipId`: string, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `mergedIntoId`?: null, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `owner`: object, `tags`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/contacts/{contactId}`

`patchContactsByContactId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `customFields`?: object, `firstName`?: string, `lastName`?: string, `companyId`?: string | null, `phone`?: string, `email`?: string, `jobTitle`?: string, `department`?: string, `notes`?: string, `ownerMembershipId`?: string | null
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `firstName`: string, `lastName`: string, `phone`: string, `email`: string, `jobTitle`?: null, `department`?: null, `socialProfiles`?: null, `notes`?: null, `ownerMembershipId`: string, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `mergedIntoId`?: null, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/contacts/{contactId}/archive`

`postContactsByContactIdArchive` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `reason`?: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `firstName`: string, `lastName`: string, `phone`: string, `email`: string, `jobTitle`?: null, `department`?: null, `socialProfiles`?: null, `notes`?: null, `ownerMembershipId`: string, `createdByMembershipId`: string, `archivedAt`: string, `archivedByMembershipId`: string, `archiveReason`?: null, `customFields`: object, `mergedIntoId`?: null, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `GET …/contacts/{contactId}/attachments`

`getContactsByContactIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `items`: any[]
- **Errors:** 401, 403, 404

### `POST …/contacts/{contactId}/attachments`

`postContactsByContactIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Body:** `name`: string, `mimeType`: string, `sizeBytes`: number, `checksumSha256`?: string, `title`?: string, `shared`?: boolean, `proposalReferenceId`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/contacts/{contactId}/comments`

`getContactsByContactIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `comments`: any[], `following`: boolean
- **Errors:** 401, 403, 404

### `POST …/contacts/{contactId}/comments`

`postContactsByContactIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `body`: string, `mentions`?: string[]
- **Returns:** `id`: string, `authorMembershipId`: string, `authorName`: string, `body`: string, `deleted`: boolean, `edited`: boolean, `editedAt`?: null, `createdAt`: string, `mentions`: any[], `canEdit`: boolean, `canDelete`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/contacts/{contactId}/comments/mentionable`

`getContactsByContactIdCommentsMentionable` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `members`: object[]
- **Errors:** 401, 403, 404

### `POST …/contacts/{contactId}/follow`

`postContactsByContactIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `DELETE …/contacts/{contactId}/follow`

`deleteContactsByContactIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `POST …/contacts/{contactId}/merge`

`postContactsByContactIdMerge` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `intoContactId`: string, `fields`?: object
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/contacts/{contactId}/restore`

`postContactsByContactIdRestore` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/contacts/{contactId}/tags`

`getContactsByContactIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `tags`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/contacts/{contactId}/tags`

`patchContactsByContactIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `addTagIds`?: string[], `addTagNames`?: string[], `removeTagIds`?: string[]
- **Returns:** `tags`: any[]
- **Errors:** 400, 401, 403, 404

### `GET …/contacts/directory`

`listContactDirectory`

Contact list with quality filters (standalone, missing email, missing phone), tag, owner and the archived tab, and a count for each

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `q`?: string, `companyId`?: string, `ownerMembershipId`?: string, `standalone`?: "true" | "false", `missingEmail`?: "true" | "false", `missingPhone`?: "true" | "false", `archived`?: "true" | "false", `tagId`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `counts`: object
- **Errors:** 400, 401, 403

### `GET …/contacts/directory/export`

`exportContactDirectory`

CSV of the contacts matching the directory filters (contacts.export; bulk-export rule)

- **Credential:** sessionCookie; **access:** management
- **Query:** `q`?: string, `companyId`?: string, `ownerMembershipId`?: string, `standalone`?: "true" | "false", `missingEmail`?: "true" | "false", `missingPhone`?: "true" | "false", `archived`?: "true" | "false", `tagId`?: string
- **Returns:** string
- **Errors:** 401, 403

### `GET …/contacts/export`

`getContactsExport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** CSV
- **Errors:** 401, 403, 404

### `POST …/contacts/import`

`postContactsImport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** multipart form with `file`
- **Returns:** `totalRows`: number, `created`: number, `duplicatesSkipped`: number, `alreadyConverted`: number, `failed`: number, `truncated`: boolean, `cancelled`: boolean, `errors`: object[]
- **Errors:** 400, 401, 403, 404

## Conversations

### `GET …/conversations`

`listConversations`

Conversations hub: tabs ALL, EMAIL, WHATSAPP, CALLS, MEETINGS, NOTES with a count for each; never lists a message linked to a record the caller cannot open

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Query:** `tab`?: string, `direction`?: string, `ownerMembershipId`?: string, `q`?: string, `from`?: string, `to`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `tab`: string, `tabCounts`: object, `access`: object
- **Errors:** 400, 401, 403

### `POST …/conversations`

`logUnlinkedConversation`

Log a call or message that matches no record; it waits in the Needs-linking queue

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Body:** `channel`: "EMAIL" | "PHONE" | "WHATSAPP" | "SMS" | "MEETING" | "OTHER", `direction`: "INBOUND" | "OUTBOUND", `summary`: string, `subject`?: string, `occurredAt`?: string, `counterpartyName`?: string, `counterpartyEmail`?: string, `counterpartyPhone`?: string
- **Returns:** `id`: string, `kind`: "COMMUNICATION" | "ACTIVITY", `channel`: string, `direction`: "INBOUND" | "OUTBOUND" | null, `occurredAt`: string, `subject`: string | null, `summary`: string | null, `needsLinking`: boolean
- **Errors:** 400, 401, 403

### `GET …/conversations/{conversationId}`

`getConversation`

One message

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `id`: string, `kind`: "COMMUNICATION" | "ACTIVITY", `channel`: string, `direction`: "INBOUND" | "OUTBOUND" | null, `occurredAt`: string, `subject`: string | null, `summary`: string | null, `needsLinking`: boolean
- **Errors:** 401, 403, 404

### `POST …/conversations/{conversationId}/create-lead`

`createLeadFromConversation`

Turn a waiting message into a lead. May answer `duplicateWarning: true` with the matches; send `confirmDuplicate` to go ahead.

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `companyId`?: string, `serviceInterestId`?: string, `leadStatusId`?: string, `firstName`?: string, `lastName`?: string, `confirmDuplicate`?: boolean
- **Returns:** `created`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/conversations/{conversationId}/dismiss`

`dismissConversation`

Take a message out of the queue, with a reason

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `reason`: string
- **Returns:** `item`: object, `alreadyDismissed`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/conversations/{conversationId}/link`

`linkConversation`

Link a waiting message to a record. Idempotent: the same record again succeeds, a different one is refused.

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string
- **Returns:** `item`: object, `alreadyLinked`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/conversations/needs-linking`

`listNeedsLinking`

Messages that matched no record. `access` says whether the caller may act or only read (Delivery reads).

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Query:** `q`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `access`: object
- **Errors:** 401, 403

### `POST …/quick-log`

`quickLog`

One-tap log of a call or WhatsApp message. Send an Idempotency-Key: a double tap logs once.

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Body:** `channel`: "CALL" | "WHATSAPP", `outcome`: "REACHED" | "NO_ANSWER" | "LEFT_MESSAGE", `note`?: string, `durationSeconds`?: number, `phoneUsed`?: string, `followUp`?: object, `contactId`?: string, `leadId`?: string, `companyId`?: string, `dealId`?: string
- **Returns:** `activityId`: string, `communicationId`: string, `taskId`: string | null
- **Errors:** 400, 401, 403, 404, 422

### `GET …/quick-log/prompt`

`getQuickLogPrompt`

What the call or WhatsApp prompt needs: the number and its tel: and wa.me links, or NO_PHONE_ON_FILE

- **Credential:** sessionCookie; **access:** management, sales
- **Query:** `contactId`?: string, `leadId`?: string, `companyId`?: string, `dealId`?: string
- **Returns:** `hasPhone`: boolean, `code`: string | null, `telHref`: string | null, `whatsappHref`: string | null
- **Errors:** 400, 401, 403, 404

## Custom Fields

### `GET …/custom-fields`

`getCustomFields` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `entityType`?: "LEAD" | "CONTACT" | "COMPANY" | "DEAL", `section`?: "GENERAL" | "QUALIFICATION", `includeInactive`?: "true" | "false"
- **Returns:** `items`: object[]
- **Errors:** 400, 401, 403, 404

### `POST …/custom-fields`

`postCustomFields` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `entityType`: "LEAD" | "CONTACT" | "COMPANY" | "DEAL", `key`: string, `label`: string, `fieldType`?: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT" | "BOOLEAN", `options`?: object[], `helpText`?: string | null, `required`?: boolean, `section`?: "GENERAL" | "QUALIFICATION", `requiredOnQualify`?: boolean, `serviceId`?: string | null, `sortOrder`?: number
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `PATCH …/custom-fields/{fieldId}`

`patchCustomFieldsByFieldId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `label`?: string, `options`?: object[], `helpText`?: string | null, `required`?: boolean, `requiredOnQualify`?: boolean, `serviceId`?: string | null, `sortOrder`?: number, `isActive`?: boolean
- **Returns:** `id`: string, `organizationId`: string, `entityType`: string, `section`: string, `key`: string, `label`: string, `fieldType`: string, `options`?: null, `helpText`?: null, `required`: boolean, `requiredOnQualify`: boolean, `serviceId`?: null, `sortOrder`: number, `isActive`: boolean, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `GET …/custom-fields/{fieldId}/usage`

`getCustomFieldsByFieldIdUsage` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `records`: number
- **Errors:** 401, 403, 404

## Customer 360

### `GET …/companies/{companyId}/360`

`getCustomer360`

Customer 360: independently loadable sections; a section the role may not read is `no_access` with who owns it

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `sections`?: string, `cursor`?: string, `limit`?: string
- **Returns:** `company`: object, `sections`: object, `requested`: string[]
- **Errors:** 400, 401, 403, 404

## Dashboard

### `GET …/dashboard`

`getDashboard`

Role home page: the sections this role has, each loaded independently (a section the role lacks is absent)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `available`: object[], `sections`?: object[]
- **Errors:** 401, 403

### `GET …/dashboard/{section}`

`getDashboardSection`

One dashboard section (sales_today, management, delivery, finance, technical, my_metrics)

- **Credential:** sessionCookie; **access:** management
- **Returns:** `key`: string, `title`: string, `scope`: string, `ok`: boolean, `data`?: any, `error`?: string
- **Errors:** 401, 403, 404

### `GET …/signals`

`getSignals`

Adoption, stalled deals, deals past close date and overdue tasks (stored values; sections by role)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `computedAt`: string
- **Errors:** 401, 403

## Data and privacy

### `GET …/privacy`

`getPrivacyOverview`

Export rights, retention with documented defaults, legal hold, open requests (Management)

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403

### `GET …/privacy/export-approvals`

`listExportApprovals`

Export approval requests (Management sees all; others their own)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Query:** `status`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 401, 403

### `POST …/privacy/export-approvals`

`requestExportApproval`

Ask Management to approve one bulk export above the threshold

- **Credential:** sessionCookie; **access:** management
- **Body:** `entity`: string, `filters`?: object, `reason`?: string
- **Returns:** object
- **Errors:** 400, 401, 403

### `POST …/privacy/export-approvals/{approvalId}/decision`

`decideExportApproval`

Approve or reject (someone other than the requester)

- **Credential:** sessionCookie; **access:** management
- **Body:** `approve`: boolean, `note`?: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `PUT …/privacy/export-rights`

`updateExportRights`

Who may bulk export, the row threshold that needs approval (default 500), how long an approval lasts

- **Credential:** sessionCookie; **access:** management
- **Body:** `allowedRoleKeys`?: string[], `approvalThreshold`?: number, `approvalExpiryHours`?: number
- **Returns:** object
- **Errors:** 400, 401, 403

### `PUT …/privacy/legal-hold`

`setLegalHold`

Place (with a reason) or release the legal hold. While on, nothing is purged and nobody can be erased.

- **Credential:** sessionCookie; **access:** management
- **Body:** `active`: boolean, `reason`?: string
- **Returns:** object
- **Errors:** 400, 401, 403

### `GET …/privacy/organisation-requests`

`listOrganisationDataRequests`

Requests to export or delete the whole organisation, with the platform team

- **Credential:** sessionCookie; **access:** management
- **Returns:** `items`: object[]
- **Errors:** 401, 403

### `POST …/privacy/organisation-requests`

`submitOrganisationDataRequest`

Ask for the whole organisation's data to be exported or the organisation deleted (handed to the platform queue)

- **Credential:** sessionCookie; **access:** management
- **Body:** `kind`: "EXPORT" | "DELETE", `note`?: string
- **Returns:** object
- **Errors:** 400, 401, 403

### `GET …/privacy/requests`

`listDataSubjectRequests`

Data-subject requests with status, due date and overdue flag

- **Credential:** sessionCookie; **access:** management
- **Query:** `status`?: string, `kind`?: string, `overdue`?: "true" | "false", `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 401, 403

### `POST …/privacy/requests`

`createDataSubjectRequest`

File an access, rectification or erasure request for a contact (due in 30 days by default)

- **Credential:** sessionCookie; **access:** management
- **Body:** `kind`: "ACCESS" | "RECTIFICATION" | "ERASURE", `contactId`: string, `evidenceNotes`?: string, `dueOn`?: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `GET …/privacy/requests/{requestId}`

`getDataSubjectRequest`

One request

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403, 404

### `POST …/privacy/requests/{requestId}/confirm-erasure`

`confirmErasure`

Two different Management members confirm; the second erases. Stopped by a legal hold.

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `GET …/privacy/requests/{requestId}/download`

`getAccessDownload`

A fresh download link for a completed access request (audited)

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403, 404

### `POST …/privacy/requests/{requestId}/evidence`

`addEvidenceNote`

Add a timestamped evidence note

- **Credential:** sessionCookie; **access:** management
- **Body:** `note`: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `POST …/privacy/requests/{requestId}/fulfil-access`

`fulfilAccessRequest`

Collect everything held about the person into one CSV and answer with a short-lived download link

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `POST …/privacy/requests/{requestId}/rectify`

`rectifyDataSubject`

Apply corrections to the person's record and complete the request

- **Credential:** sessionCookie; **access:** management
- **Body:** JSON object
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `POST …/privacy/requests/{requestId}/reject`

`rejectDataSubjectRequest`

Reject a request, with the reason

- **Credential:** sessionCookie; **access:** management
- **Body:** `reason`: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `PUT …/privacy/retention`

`updateRetention`

A retention period per kind of data: a number, null to keep, or "DEFAULT"

- **Credential:** sessionCookie; **access:** management
- **Body:** JSON object
- **Returns:** object
- **Errors:** 400, 401, 403

## Data migration

### `GET …/data-migration`

`listMigrationEntities`

What can be migrated, each kind's fields, the seven steps

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403

### `GET …/data-migration/presets`

`listMigrationPresets`

Saved mappings

- **Credential:** sessionCookie; **access:** management
- **Query:** `entity`?: string
- **Returns:** `items`: object[]
- **Errors:** 400, 401, 403

### `POST …/data-migration/presets`

`saveMigrationPreset`

Save a mapping under a name (same name updates it)

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`: string, `entity`: string, `mapping`: object, `valueMappings`?: object
- **Returns:** object
- **Errors:** 400, 401, 403

### `DELETE …/data-migration/presets/{presetId}`

`deleteMigrationPreset`

Delete a saved mapping

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403, 404

### `GET …/data-migration/sessions`

`listMigrationSessions`

Migration sessions, newest first

- **Credential:** sessionCookie; **access:** management
- **Query:** `entity`?: string, `status`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 401, 403

### `POST …/data-migration/sessions`

`createMigrationSession`

Step 1: start a session for one kind of record

- **Credential:** sessionCookie; **access:** management
- **Body:** `entity`: string, `sourceKind`?: "TEMPLATE" | "GENERIC", `presetId`?: string, `duplicatePolicy`?: "SKIP" | "UPDATE" | "CREATE", `createMissingCompanies`?: boolean
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 400, 401, 403, 404

### `GET …/data-migration/sessions/{sessionId}`

`getMigrationSession`

One session: status, step, counts, progress, dry run, rollback window

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 401, 403, 404

### `POST …/data-migration/sessions/{sessionId}/cancel`

`cancelMigration`

Stop at the next chunk. Rows already written stay and can be rolled back.

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 401, 403, 404

### `POST …/data-migration/sessions/{sessionId}/dry-run`

`dryRunMigration`

Step 5: decide what the import would create, update and skip, with a sample. Writes nothing.

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 400, 401, 403, 404

### `GET …/data-migration/sessions/{sessionId}/errors`

`getMigrationErrorReport`

The error report as CSV: problem rows beside their original values

- **Credential:** sessionCookie; **access:** management
- **Query:** `phase`?: string
- **Returns:** string
- **Errors:** 401, 403, 404

### `POST …/data-migration/sessions/{sessionId}/file`

`uploadMigrationFile`

Step 2: upload a CSV or .xlsx (multipart `file`, or the raw body with ?fileName=). Answers with headers, row count, suggested mapping.

- **Credential:** sessionCookie; **access:** management
- **Returns:** `session`: object, `suggestedMapping`: object
- **Errors:** 400, 401, 403, 404

### `POST …/data-migration/sessions/{sessionId}/import`

`startMigrationImport`

Step 6: import (needs a finished dry run and confirm: true). Every row created carries the session id.

- **Credential:** sessionCookie; **access:** management
- **Body:** `confirm`?: boolean
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 400, 401, 403, 404

### `GET …/data-migration/sessions/{sessionId}/issues`

`listMigrationIssues`

Per-row errors, warnings and duplicates, paged

- **Credential:** sessionCookie; **access:** management
- **Query:** `phase`?: string, `severity`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401, 403, 404

### `PUT …/data-migration/sessions/{sessionId}/mapping`

`setMigrationMapping`

Step 3: map fields to columns, map values (statuses, sources, services, owners by email), choose the duplicate policy

- **Credential:** sessionCookie; **access:** management
- **Body:** `mapping`?: object, `valueMappings`?: object, `duplicatePolicy`?: "SKIP" | "UPDATE" | "CREATE", `createMissingCompanies`?: boolean, `savePresetAs`?: string, `presetId`?: string | null
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 400, 401, 403, 404

### `POST …/data-migration/sessions/{sessionId}/rollback`

`rollbackMigration`

Step 7: undo the whole session within its window; records changed or relied on since are kept, with the reason

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 400, 401, 403, 404

### `POST …/data-migration/sessions/{sessionId}/validate`

`validateMigration`

Step 4: read every row and record per-row errors and warnings (background job)

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `entity`: string, `status`: string, `step`: string, `counts`: object, `rollback`: object
- **Errors:** 400, 401, 403, 404

### `GET …/data-migration/templates/{entity}`

`getMigrationTemplate`

The fixed CSV template for one kind of record

- **Credential:** sessionCookie; **access:** management
- **Returns:** string
- **Errors:** 400, 401, 403

## Deal Moves

### `POST …/deal-moves/{moveId}/undo`

`postDealMovesByMoveIdUndo` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** any
- **Errors:** 401, 403, 404

## Deal Rules

### `GET …/deal-rules`

`getDealRules` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `defaultStalledDays`: number, `stages`: object[], `min`: number, `max`: number
- **Errors:** 401, 403, 404

### `PATCH …/deal-rules`

`patchDealRules` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `defaultStalledDays`?: number, `stages`?: object
- **Returns:** `defaultStalledDays`: number, `stages`: object[], `min`: number, `max`: number
- **Errors:** 400, 401, 403, 404

## Deals

### `GET …/deals`

`getDeals` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `tagId`?: string, `q`?: string, `ownerMembershipId`?: string, `pipelineStageId`?: string, `outcome`?: "OPEN" | "WON" | "LOST", `companyId`?: string, `includeArchived`?: "true" | "false", `archivedOnly`?: "true" | "false", `stalled`?: "true" | "false", `closeDatePassed`?: "true" | "false", `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/deals`

`postDeals` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `customFields`?: object, `companyId`: string, `primaryContactId`?: string, `serviceId`?: string, `ownerMembershipId`?: string, `pipelineStageId`: string, `value`?: number | string, `currency`?: string, `expectedCloseDate`?: string, `notes`?: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `primaryContactId`?: null, `leadId`?: null, `serviceId`?: null, `ownerMembershipId`: string, `pipelineStageId`: string, `value`?: null, `currency`: string, `expectedCloseDate`?: null, `outcome`: string, `lostReasonId`?: null, `wonAt`?: null, `lostAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `lastActivityAt`: string, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `primaryContact`?: null, `lead`?: null, `service`?: null, `pipelineStage`: object, `lostReason`?: null, `tagLinks`: any[], `valueMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/deals/{dealId}`

`getDeal`

Get one deal (value masked for roles without deals.view.value)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `primaryContactId`: string | null, `leadId`: string | null, `serviceId`: string | null, `ownerMembershipId`: string, `pipelineStageId`: string, `value`: string | null, `currency`: string, `expectedCloseDate`: string | null, `outcome`: "OPEN" | "WON" | "LOST", `lostReasonId`: string | null, `wonAt`: string | null, `lostAt`: string | null, `notes`: string | null, `customFields`: object, `tags`: object[], `lastActivityAt`: string, `signals`: object | null, `createdByMembershipId`: string | null, `importSessionId`: string | null, `archivedAt`: string | null, `createdAt`: string, `updatedAt`: string, `company`: object, `primaryContact`: object | null, `lead`: object | null, `service`: object | null, `pipelineStage`: object, `lostReason`: object | null, `valueMasked`: boolean, `archived`: boolean, `archive`: object | null, `archivedByMembershipId`: string | null, `archiveReason`: string | null, `masked`: boolean, `scope`: "own" | "organisation" | "read-only", `provisional`: boolean
- **Errors:** 401, 403, 404

### `PATCH …/deals/{dealId}`

`patchDealsByDealId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `customFields`?: object, `primaryContactId`?: string | null, `serviceId`?: string | null, `pipelineStageId`?: string, `lostReasonId`?: string | null, `value`?: number | string | null, `currency`?: string, `expectedCloseDate`?: string | null, `notes`?: string | null, `handoff`?: object
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `primaryContactId`: string, `leadId`?: null, `serviceId`?: null, `ownerMembershipId`: string, `pipelineStageId`: string, `value`: string, `currency`: string, `expectedCloseDate`?: null, `outcome`: string, `lostReasonId`?: null, `wonAt`?: null, `lostAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `lastActivityAt`: string, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `primaryContact`: object, `lead`?: null, `service`?: null, `pipelineStage`: object, `lostReason`?: null, `tagLinks`: any[], `valueMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/deals/{dealId}/archive`

`postDealsByDealIdArchive` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `reason`?: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `primaryContactId`: string, `leadId`?: null, `serviceId`?: null, `ownerMembershipId`: string, `pipelineStageId`: string, `value`: string, `currency`: string, `expectedCloseDate`?: null, `outcome`: string, `lostReasonId`?: null, `wonAt`?: null, `lostAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`: string, `archivedByMembershipId`: string, `archiveReason`?: null, `customFields`: object, `lastActivityAt`: string, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `primaryContact`: object, `lead`?: null, `service`?: null, `pipelineStage`: object, `lostReason`?: null, `tagLinks`: any[], `valueMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/deals/{dealId}/assign`

`postDealsByDealIdAssign` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `ownerMembershipId`: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `primaryContactId`: string, `leadId`?: null, `serviceId`?: null, `ownerMembershipId`: string, `pipelineStageId`: string, `value`: string, `currency`: string, `expectedCloseDate`?: null, `outcome`: string, `lostReasonId`?: null, `wonAt`?: null, `lostAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `lastActivityAt`: string, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `primaryContact`: object, `lead`?: null, `service`?: null, `pipelineStage`: object, `lostReason`?: null, `tagLinks`: any[], `valueMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/deals/{dealId}/attachments`

`getDealsByDealIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `items`: any[]
- **Errors:** 401, 403, 404

### `POST …/deals/{dealId}/attachments`

`postDealsByDealIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `name`: string, `mimeType`: string, `sizeBytes`: number, `checksumSha256`?: string, `title`?: string, `shared`?: boolean, `proposalReferenceId`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/deals/{dealId}/comments`

`getDealsByDealIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `comments`: any[], `following`: boolean
- **Errors:** 401, 403, 404

### `POST …/deals/{dealId}/comments`

`postDealsByDealIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `body`: string, `mentions`?: string[]
- **Returns:** `id`: string, `authorMembershipId`: string, `authorName`: string, `body`: string, `deleted`: boolean, `edited`: boolean, `editedAt`?: null, `createdAt`: string, `mentions`: any[], `canEdit`: boolean, `canDelete`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/deals/{dealId}/comments/mentionable`

`getDealsByDealIdCommentsMentionable` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `members`: object[]
- **Errors:** 401, 403, 404

### `POST …/deals/{dealId}/follow`

`postDealsByDealIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `DELETE …/deals/{dealId}/follow`

`deleteDealsByDealIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `GET …/deals/{dealId}/handoff`

`getDealsByDealIdHandoff` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `handoff`?: null
- **Errors:** 401, 403, 404

### `PATCH …/deals/{dealId}/handoff`

`patchDealsByDealIdHandoff` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `scope`?: string | null, `requirements`?: string | null, `startDate`?: string | null, `deliverables`?: object[], `teamMembershipIds`?: string[], `status`?: "ONBOARDING" | "DELIVERED"
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/deals/{dealId}/handoff/take`

`postDealsByDealIdHandoffTake` · *derived*

- **Credential:** sessionCookie; **access:** management, delivery
- **Returns:** any
- **Errors:** 401, 403, 404

### `POST …/deals/{dealId}/move`

`postDealsByDealIdMove` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `pipelineStageId`: string, `lostReasonId`?: string | null, `handoff`?: object
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/deals/{dealId}/move-check`

`postDealsByDealIdMoveCheck` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `pipelineStageId`: string, `lostReasonId`?: string | null, `handoff`?: object
- **Returns:** `allowed`: boolean, `blockers`: object[], `needsLostReason`: boolean, `handoffPrompt`: boolean, `reopens`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/deals/{dealId}/proposals`

`getDealsByDealIdProposals` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** object[]
- **Errors:** 401, 403, 404

### `POST …/deals/{dealId}/proposals`

`postDealsByDealIdProposals` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `proposalNumber`: string, `amount`?: number | string, `currency`?: string, `documentReference`?: string, `notes`?: string
- **Returns:** `id`: string, `organizationId`: string, `dealId`: string, `proposalNumber`: string, `status`: string, `amount`?: null, `currency`: string, `ownerMembershipId`: string, `sentAt`?: null, `respondedAt`?: null, `documentReference`?: null, `notes`?: null, `createdAt`: string, `updatedAt`: string, `amountMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `PATCH …/deals/{dealId}/proposals/{proposalId}`

`patchDealsByDealIdProposalsByProposalId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `status`: "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "REJECTED" | "EXPIRED"
- **Returns:** `id`: string, `organizationId`: string, `dealId`: string, `proposalNumber`: string, `status`: string, `amount`: string, `currency`: string, `ownerMembershipId`: string, `sentAt`?: null, `respondedAt`?: null, `documentReference`?: null, `notes`?: null, `createdAt`: string, `updatedAt`: string, `amountMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/deals/{dealId}/restore`

`postDealsByDealIdRestore` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/deals/{dealId}/tags`

`getDealsByDealIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `tags`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/deals/{dealId}/tags`

`patchDealsByDealIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Body:** `addTagIds`?: string[], `addTagNames`?: string[], `removeTagIds`?: string[]
- **Returns:** `tags`: any[]
- **Errors:** 400, 401, 403, 404

### `GET …/deals/board`

`getDealsBoard` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `ownerMembershipId`?: string, `companyId`?: string, `includeArchived`?: "true" | "false"
- **Returns:** `columns`: object[], `defaultStalledDays`: number
- **Errors:** 400, 401, 403, 404

### `GET …/deals/export`

`getDealsExport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** CSV
- **Errors:** 401, 403, 404

## Duplicates

### `POST …/duplicates/check`

`postDuplicatesCheck` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `entity`: "lead" | "contact" | "company", `companyName`?: string | null, `firstName`?: string | null, `lastName`?: string | null, `email`?: string | null, `phone`?: string | null, `website`?: string | null, `companyId`?: string | null, `contactId`?: string | null, `excludeId`?: string | null
- **Returns:** `candidates`: any[], `hiddenCount`: number
- **Errors:** 400, 401, 403, 404

## Email Templates

### `GET …/email-templates`

`getEmailTemplates` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Query:** `includeInactive`?: "true" | "false"
- **Returns:** `items`: object[], `mergeFields`: string[]
- **Errors:** 400, 401, 403, 404

### `POST …/email-templates`

`postEmailTemplates` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`: string, `subject`: string, `body`: string
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `subject`: string, `body`: string, `isActive`: boolean, `createdByMembershipId`: string, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `PATCH …/email-templates/{templateId}`

`patchEmailTemplatesByTemplateId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`?: string, `subject`?: string, `body`?: string, `isActive`?: boolean
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `subject`: string, `body`: string, `isActive`: boolean, `createdByMembershipId`: string, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `DELETE …/email-templates/{templateId}`

`deleteEmailTemplatesByTemplateId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string
- **Errors:** 401, 403, 404

### `POST …/email-templates/{templateId}/render`

`postEmailTemplatesByTemplateIdRender` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Body:** `contactId`?: string, `companyId`?: string, `leadId`?: string, `dealId`?: string
- **Returns:** `templateId`: string, `subject`: string, `body`: string, `missing`: string[]
- **Errors:** 400, 401, 403, 404

## Features

### `GET …/features`

`getFeatures`

Release flags and organisation toggles, resolved for this organisation

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `release`: "v1" | "v1.1" | "v2", `flags`: object, `toggles`: object[]
- **Errors:** 401, 403

### `PATCH …/features`

`updateFeatureToggles`

Switch organisation toggles (Management only; audited)

- **Credential:** sessionCookie; **access:** management
- **Body:** `toggles`: object
- **Returns:** `release`: "v1" | "v1.1" | "v2", `flags`: object, `toggles`: object[]
- **Errors:** 400, 401, 403

## Files

### `POST …/files`

`createFileUpload`

Start a file upload: returns a short-lived signed link to send the bytes to

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Body:** `purpose`: "AVATAR" | "LOGO" | "ATTACHMENT" | "IMPORT" | "EXPORT", `name`: string, `mimeType`: string, `sizeBytes`: number, `checksumSha256`?: string
- **Returns:** `file`: object, `upload`: object
- **Errors:** 400, 401, 403

### `GET …/files/{fileId}`

`getFile`

A file's metadata (404 for a file the caller may not see)

- **Credential:** sessionCookie; **access:** management, sales, finance, restricted technical, customer support
- **Returns:** `id`: string, `purpose`: "AVATAR" | "LOGO" | "ATTACHMENT" | "IMPORT" | "EXPORT", `name`: string, `sizeBytes`: number, `mimeType`: string, `status`: "UPLOADING" | "READY" | "QUARANTINED" | "DELETED", `checksumSha256`: string | null, `ownerMembershipId`: string | null, `createdAt`: string, `readyAt`: string | null
- **Errors:** 401, 404

### `DELETE …/files/{fileId}`

`deleteFile`

Delete a file (kept until the retention purge removes its bytes)

- **Credential:** sessionCookie; **access:** management, sales, finance, restricted technical, customer support
- **Returns:** `id`: string, `purpose`: "AVATAR" | "LOGO" | "ATTACHMENT" | "IMPORT" | "EXPORT", `name`: string, `sizeBytes`: number, `mimeType`: string, `status`: "UPLOADING" | "READY" | "QUARANTINED" | "DELETED", `checksumSha256`: string | null, `ownerMembershipId`: string | null, `createdAt`: string, `readyAt`: string | null
- **Errors:** 401, 404

### `POST …/files/{fileId}/complete`

`completeFileUpload`

Finish an upload: checks size, type, content and checksum, scans for malware, then makes the file ready

- **Credential:** sessionCookie; **access:** management, sales, finance, restricted technical, customer support
- **Returns:** `id`: string, `purpose`: "AVATAR" | "LOGO" | "ATTACHMENT" | "IMPORT" | "EXPORT", `name`: string, `sizeBytes`: number, `mimeType`: string, `status`: "UPLOADING" | "READY" | "QUARANTINED" | "DELETED", `checksumSha256`: string | null, `ownerMembershipId`: string | null, `createdAt`: string, `readyAt`: string | null
- **Errors:** 400, 401, 404, 409, 503

### `GET …/files/{fileId}/content`

`getFilesByFileIdContent` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, finance, restricted technical, customer support
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/files/{fileId}/download`

`getFileDownloadLink`

A signed download link, valid for about a minute

- **Credential:** sessionCookie; **access:** management, sales, finance, restricted technical, customer support
- **Returns:** `file`: object, `download`: object
- **Errors:** 401, 404, 409

### `GET /api/storage/blob`

`downloadSignedBlob`

Download a file with a signed link (local storage driver only; the S3 driver links straight to the bucket).

- **Credential:** signedToken
- **Errors:** 403, 404, 409

### `PUT /api/storage/blob`

`uploadSignedBlob`

Upload a file's bytes with a signed upload link (local storage driver only).

- **Credential:** signedToken
- **Errors:** 400, 403, 404

## Handoff Settings

### `GET …/handoff-settings`

`getHandoffSettings` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `tasks`: object[], `customerLifecycleStateId`?: null, `managementCanMarkDelivered`: boolean
- **Errors:** 401, 403, 404

### `PUT …/handoff-settings`

`putHandoffSettings` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `tasks`: object[], `customerLifecycleStateId`?: string | null, `managementCanMarkDelivered`?: boolean
- **Returns:** `tasks`: any[], `customerLifecycleStateId`?: null, `managementCanMarkDelivered`: boolean
- **Errors:** 400, 401, 403, 404

## Handoffs

### `GET …/handoffs`

`getHandoffs` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery
- **Query:** `status`?: string, `mine`?: "true" | "false", `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null, `counts`: object
- **Errors:** 400, 401, 403, 404

## Import and export

### `GET …/data-runs`

`listDataRuns`

Imports and exports: your own, or everyone's for Management

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Query:** `kind`?: "IMPORT" | "EXPORT", `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401

### `GET …/data-runs/{runId}`

`getDataRun`

Progress, counts and state of one import or export

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `id`: string, `kind`: "IMPORT" | "EXPORT", `entity`: string, `status`: "QUEUED" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "CANCELLED", `done`: boolean, `totalRows`: number, `processedRows`: number, `createdRows`: number, `duplicateRows`: number, `alreadyConvertedRows`: number, `failedRows`: number, `hasResultFile`: boolean, `hasErrorReport`: boolean
- **Errors:** 401, 404

### `POST …/data-runs/{runId}/cancel`

`cancelDataRun`

Stop a running import or export at its next check; rows already imported stay

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `id`: string, `kind`: "IMPORT" | "EXPORT", `entity`: string, `status`: "QUEUED" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "CANCELLED", `done`: boolean, `totalRows`: number, `processedRows`: number, `createdRows`: number, `duplicateRows`: number, `alreadyConvertedRows`: number, `failedRows`: number, `hasResultFile`: boolean, `hasErrorReport`: boolean
- **Errors:** 401, 404

### `GET …/data-runs/{runId}/download`

`downloadDataRunFile`

Short-lived signed link to the export (`which=result`) or the import error report (`which=errors`)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Query:** `which`?: "result" | "errors"
- **Returns:** `fileName`: string, `download`: object
- **Errors:** 401, 404

### `POST …/exports`

`startExport`

Start a background export of the full filtered set (over 500 rows needs export.bulk)

- **Credential:** sessionCookie; **access:** management
- **Body:** `entity`: "LEAD" | "CONTACT" | "COMPANY" | "DEAL", `filters`?: object
- **Returns:** `id`: string, `kind`: "IMPORT" | "EXPORT", `entity`: string, `status`: "QUEUED" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "CANCELLED", `done`: boolean, `totalRows`: number, `processedRows`: number, `createdRows`: number, `duplicateRows`: number, `alreadyConvertedRows`: number, `failedRows`: number, `hasResultFile`: boolean, `hasErrorReport`: boolean
- **Errors:** 400, 401, 403

## Imports

### `POST …/imports`

`postImports` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** multipart form with `file`
- **Returns:** `id`: string, `kind`: string, `entity`: string, `status`: string, `done`: boolean, `totalRows`: number, `processedRows`: number, `createdRows`: number, `duplicateRows`: number, `alreadyConvertedRows`: number, `failedRows`: number, `truncated`: boolean, `cancelRequested`: boolean, `failureMessage`?: null, `hasResultFile`: boolean, `hasErrorReport`: boolean, `createdByMembershipId`: string, `startedAt`?: null, `finishedAt`?: null, `createdAt`: string
- **Errors:** 400, 401, 403, 404

## Integrations

### `GET …/integrations`

`listIntegrations`

Integrations registry: Connected, Not connected or Planned, each derived from real signals (Management)

- **Credential:** sessionCookie; **access:** management
- **Returns:** `integrations`: object[], `counts`: object
- **Errors:** 401, 403

### `GET …/integrations/inbound-email-key`

`getIntegrationsInboundEmailKey` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `configured`: boolean
- **Errors:** 401, 403, 404

### `POST …/integrations/inbound-email-key`

`postIntegrationsInboundEmailKey` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `token`: string, `keyPrefix`: string
- **Errors:** 401, 403, 404

### `POST …/integrations/inbound-email-key/revoke`

`postIntegrationsInboundEmailKeyRevoke` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/integrations/website-key`

`getIntegrationsWebsiteKey` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `configured`: boolean
- **Errors:** 401, 403, 404

### `POST …/integrations/website-key`

`postIntegrationsWebsiteKey` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `graceHours`?: number
- **Returns:** `apiKey`: string, `keyPrefix`: string, `previousKeyValidUntil`: string
- **Errors:** 400, 401, 403, 404

### `GET …/integrations/website-key/acknowledgement`

`getIntegrationsWebsiteKeyAcknowledgement` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `enabled`: boolean
- **Errors:** 401, 403, 404

### `POST …/integrations/website-key/acknowledgement`

`postIntegrationsWebsiteKeyAcknowledgement` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `enabled`: boolean
- **Returns:** `enabled`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/integrations/website-key/activity`

`getIntegrationsWebsiteKeyActivity` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** any[]
- **Errors:** 401, 403, 404

### `GET …/integrations/website-key/assignment`

`getIntegrationsWebsiteKeyAssignment` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `mode`: string
- **Errors:** 401, 403, 404

### `POST …/integrations/website-key/assignment`

`postIntegrationsWebsiteKeyAssignment` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `mode`: "ROUND_ROBIN" | "UNASSIGNED"
- **Returns:** `mode`: string
- **Errors:** 400, 401, 403, 404

### `GET …/integrations/website-key/rejected`

`listRejectedWebsiteSubmissions`

Website submissions that were turned away, with the reason in plain words (Management)

- **Credential:** sessionCookie; **access:** management
- **Query:** `outcome`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401, 403

### `POST …/integrations/website-key/revoke`

`postIntegrationsWebsiteKeyRevoke` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** any
- **Errors:** 401, 403, 404

### `POST …/integrations/website-key/settings`

`postIntegrationsWebsiteKeySettings` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `allowedOrigins`?: string[], `honeypotFieldName`?: string | null, `captchaSecret`?: string | null
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/integrations/whatsapp`

`getWhatsAppConfig`

Click-to-chat configuration: organisation number, default message, templates (Management)

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403

### `PUT …/integrations/whatsapp`

`updateWhatsAppConfig`

Set the WhatsApp number (any local form) and the message templates used by wa.me links

- **Credential:** sessionCookie; **access:** management
- **Body:** `number`?: string | null, `defaultMessage`?: string, `templates`?: object[]
- **Returns:** object
- **Errors:** 400, 401, 403

## Jobs

### `GET …/jobs`

`listJobs`

Background jobs for this organisation with counts per status (Management)

- **Credential:** sessionCookie; **access:** management
- **Query:** `status`?: "QUEUED" | "RUNNING" | "SUCCEEDED" | "DEAD" | "CANCELLED", `type`?: string, `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `counts`: object
- **Errors:** 400, 401, 403

### `GET …/jobs/{jobId}`

`getJobsByJobId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `type`: string, `status`: string, `attempts`: number, `maxAttempts`: number, `runAt`: string, `startedAt`?: null, `finishedAt`?: null, `lastError`?: null, `requestId`: string, `createdAt`: string
- **Errors:** 401, 403, 404

### `POST …/jobs/{jobId}/cancel`

`postJobsByJobIdCancel` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `type`: string, `status`: string, `attempts`: number, `maxAttempts`: number, `runAt`: string, `startedAt`?: null, `finishedAt`: string, `lastError`?: null, `requestId`: string, `createdAt`: string
- **Errors:** 401, 403, 404

### `POST …/jobs/{jobId}/retry`

`postJobsByJobIdRetry` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/jobs/schedules`

`getJobsSchedules` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `schedules`: object[]
- **Errors:** 401, 403, 404

## Lead Pool

### `GET …/lead-pool/requests`

`getLeadPoolRequests` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Query:** `status`?: string, `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/lead-pool/requests/{requestId}/cancel`

`postLeadPoolRequestsByRequestIdCancel` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `id`: string, `organizationId`: string, `leadId`: string, `requesterMembershipId`: string, `status`: string, `note`?: null, `decisionReason`?: null, `decidedByMembershipId`: string, `decidedAt`: string, `createdAt`: string, `updatedAt`: string, `lead`: object
- **Errors:** 401, 404

### `POST …/lead-pool/requests/{requestId}/decide`

`postLeadPoolRequestsByRequestIdDecide` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `decision`: "APPROVE" | "DECLINE", `reason`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/lead-pool/settings`

`getLeadPoolSettings` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `mode`: string
- **Errors:** 401, 404

### `PATCH …/lead-pool/settings`

`patchLeadPoolSettings` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `mode`: "approval" | "auto"
- **Returns:** `mode`: string
- **Errors:** 400, 401, 403, 404

## Leads

### `GET …/leads`

`listLeads`

List leads (paged; own or organisation scope by role)

- **Credential:** sessionCookie; **access:** management, sales
- **Query:** `tagId`?: string, `q`?: string, `ownerMembershipId`?: string, `leadStatusId`?: string, `leadSourceId`?: string, `temperature`?: "HOT" | "WARM" | "COLD", `includeArchived`?: "true" | "false", `archivedOnly`?: "true" | "false", `page`?: number, `pageSize`?: number, `limit`?: number, `cursor`?: string, `sort`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401, 403

### `POST …/leads`

`createLead`

Create a lead

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `leadStatusId`: string, `companyId`?: string, `contactId`?: string, `leadSourceId`?: string, `temperature`?: "HOT" | "WARM" | "COLD", `serviceInterestId`?: string, `ownerMembershipId`?: string, `qualificationData`?: any, `customFields`?: object
- **Returns:** `lead`: object, `possibleDuplicates`: object[], `duplicates`: object[], `hiddenDuplicates`: number
- **Errors:** 400, 401, 403, 409, 422

### `GET …/leads/{leadId}`

`getLeadsByLeadId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `contactId`: string, `leadSourceId`?: null, `leadStatusId`: string, `temperature`: string, `serviceInterestId`?: null, `ownerMembershipId`: string, `qualificationData`?: null, `lostReasonId`?: null, `nextFollowUpAt`?: null, `convertedAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `scoreValue`: number, `scoreBand`: string, `scoreFactors`: object[], `scoredAt`: string, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `contact`: object, `leadStatus`: object, `leadSource`?: null, `lostReason`?: null, `tagLinks`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/leads/{leadId}`

`patchLeadsByLeadId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `customFields`?: object, `leadStatusId`?: string, `companyId`?: string | null, `contactId`?: string | null, `leadSourceId`?: string | null, `temperature`?: "HOT" | "WARM" | "COLD", `serviceInterestId`?: string | null, `qualificationData`?: any, `lostReasonId`?: string | null, `nextFollowUpAt`?: any | null, `notes`?: string | null
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `contactId`: string, `leadSourceId`?: null, `leadStatusId`: string, `temperature`: string, `serviceInterestId`?: null, `ownerMembershipId`: string, `qualificationData`?: null, `lostReasonId`?: null, `nextFollowUpAt`?: null, `convertedAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `scoreValue`: number, `scoreBand`: string, `scoreFactors`: object[], `scoredAt`: string, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/leads/{leadId}/archive`

`postLeadsByLeadIdArchive` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `reason`?: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `contactId`: string, `leadSourceId`?: null, `leadStatusId`: string, `temperature`: string, `serviceInterestId`?: null, `ownerMembershipId`: string, `qualificationData`?: null, `lostReasonId`?: null, `nextFollowUpAt`?: null, `convertedAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`: string, `archivedByMembershipId`: string, `archiveReason`?: null, `customFields`: object, `scoreValue`: number, `scoreBand`: string, `scoreFactors`: object[], `scoredAt`: string, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/leads/{leadId}/ask-to-take`

`postLeadsByLeadIdAskToTake` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `note`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/leads/{leadId}/assign`

`postLeadsByLeadIdAssign` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `ownerMembershipId`: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `contactId`: string, `leadSourceId`?: null, `leadStatusId`: string, `temperature`: string, `serviceInterestId`?: null, `ownerMembershipId`: string, `qualificationData`?: null, `lostReasonId`?: null, `nextFollowUpAt`?: null, `convertedAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `scoreValue`: number, `scoreBand`: string, `scoreFactors`: object[], `scoredAt`: string, `lastContactedAt`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `GET …/leads/{leadId}/attachments`

`getLeadsByLeadIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `items`: object[]
- **Errors:** 401, 403, 404

### `POST …/leads/{leadId}/attachments`

`postLeadsByLeadIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `name`: string, `mimeType`: string, `sizeBytes`: number, `checksumSha256`?: string, `title`?: string, `shared`?: boolean, `proposalReferenceId`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/leads/{leadId}/comments/mentionable`

`getLeadsByLeadIdCommentsMentionable` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `members`: object[]
- **Errors:** 401, 403, 404

### `POST …/leads/{leadId}/convert`

`postLeadsByLeadIdConvert` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `companyId`?: string, `newCompany`?: object, `newContact`?: object, `ownerMembershipId`?: string, `pipelineStageId`?: string, `serviceId`?: string, `value`?: number | string, `expectedCloseDate`?: string, `notes`?: string
- **Returns:** `id`: string, `organizationId`: string, `companyId`: string, `primaryContactId`: string, `leadId`: string, `serviceId`?: null, `ownerMembershipId`: string, `pipelineStageId`: string, `value`?: null, `currency`: string, `expectedCloseDate`?: null, `outcome`: string, `lostReasonId`?: null, `wonAt`?: null, `lostAt`?: null, `notes`?: null, `createdByMembershipId`: string, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `customFields`: object, `lastActivityAt`: string, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null, `company`: object, `primaryContact`: object, `lead`: object, `service`?: null, `pipelineStage`: object, `lostReason`?: null, `tagLinks`: any[]
- **Errors:** 400, 401, 403, 404

### `POST …/leads/{leadId}/follow`

`postLeadsByLeadIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `DELETE …/leads/{leadId}/follow`

`deleteLeadsByLeadIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `GET …/leads/{leadId}/qualification`

`getLeadsByLeadIdQualification` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `leadId`: string, `serviceInterestId`?: null, `questions`: object[], `keptAnswers`: any[], `progress`: object
- **Errors:** 401, 403, 404

### `PATCH …/leads/{leadId}/qualification`

`patchLeadsByLeadIdQualification` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `answers`: object
- **Returns:** `leadId`: string, `serviceInterestId`?: null, `questions`: object[], `keptAnswers`: any[], `progress`: object
- **Errors:** 400, 401, 403, 404

### `POST …/leads/{leadId}/restore`

`postLeadsByLeadIdRestore` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/leads/{leadId}/score`

`getLeadsByLeadIdScore` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `score`: number, `band`: string, `factors`: object[], `computedAt`: string
- **Errors:** 401, 403, 404

### `GET …/leads/{leadId}/tags`

`getLeadsByLeadIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `tags`: any[]
- **Errors:** 401, 403, 404

### `PATCH …/leads/{leadId}/tags`

`patchLeadsByLeadIdTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `addTagIds`?: string[], `addTagNames`?: string[], `removeTagIds`?: string[]
- **Returns:** `tags`: any[]
- **Errors:** 400, 401, 403, 404

### `POST …/leads/check-duplicates`

`postLeadsCheckDuplicates` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `contactEmail`?: string, `contactPhone`?: string, `companyId`?: string
- **Returns:** `possibleDuplicates`: any[], `duplicates`: any[], `hiddenDuplicates`: number
- **Errors:** 400, 401, 403, 404

### `GET …/leads/export`

`getLeadsExport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** CSV
- **Errors:** 401, 403, 404

### `POST …/leads/import`

`postLeadsImport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** multipart form with `file`
- **Returns:** `totalRows`: number, `created`: number, `duplicatesSkipped`: number, `alreadyConverted`: number, `failed`: number, `truncated`: boolean, `cancelled`: boolean, `errors`: object[]
- **Errors:** 400, 401, 403, 404

### `GET …/leads/pool`

`getLeadsPool` · *derived*

- **Credential:** sessionCookie; **access:** management, sales
- **Query:** `q`?: string, `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

## Lifecycle

### `GET …/companies/{companyId}/lifecycle`

`getCompanyLifecycle`

The lifecycle state of a company and its history

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `state`: object | null, `manual`: boolean, `events`: object[]
- **Errors:** 401, 403, 404

### `PUT …/companies/{companyId}/lifecycle`

`setCompanyLifecycle`

Set the state by hand, with a reason; the daily job then leaves the company alone

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `stateId`?: string, `stateKey`?: string, `reason`: string
- **Returns:** `manual`: boolean
- **Errors:** 400, 401, 403, 404

### `DELETE …/companies/{companyId}/lifecycle`

`releaseCompanyLifecycle`

Hand the company back to the rules

- **Credential:** sessionCookie; **access:** management, sales
- **Returns:** `manual`: boolean
- **Errors:** 401, 403, 404

## Me

### `GET /api/me/context`

`getMyContext`

Everything the shell needs to draw itself, in one shape for every role (sections that do not apply are null)

- **Credential:** sessionCookie
- **Query:** `org`?: string
- **Returns:** object | object
- **Errors:** 401, 404

### `GET /api/me/sessions`

`listMySessions`

Every device the person is signed in on, current one first.

- **Credential:** sessionCookie
- **Returns:** `items`: object[]
- **Errors:** 401

### `DELETE /api/me/sessions/{sessionId}`

`revokeMySession`

Sign out one device.

- **Credential:** sessionCookie
- **Returns:** object
- **Errors:** 401, 404

### `POST /api/me/sessions/sign-out-others`

`signOutOtherSessions`

Sign out every other device.

- **Credential:** sessionCookie
- **Returns:** object
- **Errors:** 401

### `GET /api/me/sign-in-events`

`listMySignInEvents`

The person's recent sign-ins and failed attempts.

- **Credential:** sessionCookie
- **Returns:** object
- **Errors:** 401

## Memberships

### `GET …/memberships`

`getMemberships` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** object[]
- **Errors:** 401, 403, 404

### `POST …/memberships`

`postMemberships` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `email`: string, `name`: string, `roleKey`: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/memberships/{membershipId}/deactivate`

`postMembershipsByMembershipIdDeactivate` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `organizationId`: string, `userId`: string, `roleId`: string, `status`: string, `invitedAt`?: null, `joinedAt`: string, `inviteTokenHash`?: null, `inviteTokenExpiresAt`?: null, `invitedByMembershipId`?: null, `inviteLastSentAt`?: null, `deactivatedAt`: string, `deactivatedByMembershipId`: string, `removedAt`?: null, `removedByMembershipId`?: null, `avatarFileId`?: null, `avatarCrop`?: null, `avatarUpdatedAt`?: null, `createdAt`: string, `updatedAt`: string, `reassignment`: object
- **Errors:** 401, 403, 404

### `POST …/memberships/{membershipId}/reactivate`

`postMembershipsByMembershipIdReactivate` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** any
- **Errors:** 401, 403, 404

### `POST …/memberships/{membershipId}/reassign`

`postMembershipsByMembershipIdReassign` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `toMembershipId`: string, `kinds`?: "tasks" | "leads" | "deals" | "companies" | "contacts" | "proposals"[]
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/memberships/{membershipId}/reassignment`

`getMembershipsByMembershipIdReassignment` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `membershipId`: string, `userName`: string, `total`: number, `totals`: object, `items`: object
- **Errors:** 401, 403, 404

### `POST …/memberships/{membershipId}/remove`

`postMembershipsByMembershipIdRemove` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string, `organizationId`: string, `userId`: string, `roleId`: string, `status`: string, `invitedAt`?: null, `joinedAt`: string, `inviteTokenHash`?: null, `inviteTokenExpiresAt`?: null, `invitedByMembershipId`?: null, `inviteLastSentAt`?: null, `deactivatedAt`?: null, `deactivatedByMembershipId`?: null, `removedAt`: string, `removedByMembershipId`: string, `avatarFileId`?: null, `avatarCrop`?: null, `avatarUpdatedAt`?: null, `createdAt`: string, `updatedAt`: string
- **Errors:** 401, 403, 404

### `POST …/memberships/{membershipId}/resend-invite`

`postMembershipsByMembershipIdResendInvite` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** any
- **Errors:** 401, 403, 404

### `POST …/memberships/{membershipId}/role`

`postMembershipsByMembershipIdRole` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `roleKey`: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/memberships/{membershipId}/unlock`

`postMembershipsByMembershipIdUnlock` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `membershipId`: string, `unlocked`: boolean, `wasLocked`: boolean
- **Errors:** 401, 403, 404

## Merges

### `POST …/merges/{mergeId}/undo`

`postMergesByMergeIdUndo` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** any
- **Errors:** 401, 404

## My Work

### `GET …/my-work`

`getMyWork` · *derived*

- **Credential:** sessionCookie; **access:** restricted technical
- **Query:** `groups`?: string, `pageSize`?: string
- **Returns:** `timeZone`: string, `counts`: object, `groups`: object[]
- **Errors:** 400, 401, 403, 404

## Notification Preferences

### `GET …/notification-preferences`

`getNotificationPreferences` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `LEAD_ASSIGNED`: object, `TASK_DUE`: object, `TASK_OVERDUE`: object, `DEAL_WON_HANDOFF`: object, `MENTION`: object, `RENEWAL_DUE`: object, `PROPOSAL_UNANSWERED`: object, `STALLED_DEAL`: object, `SUPPORT_ACCESS_REQUEST`: object, `LEAD_POOL`: object, `PAYMENT_OVERDUE`: object, `DORMANT_CUSTOMER`: object
- **Errors:** 401, 404

### `POST …/notification-preferences`

`postNotificationPreferences` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `type`: "LEAD_ASSIGNED" | "TASK_DUE" | "TASK_OVERDUE" | "DEAL_WON_HANDOFF" | "MENTION" | "RENEWAL_DUE" | "PROPOSAL_UNANSWERED" | "STALLED_DEAL" | "SUPPORT_ACCESS_REQUEST" | "LEAD_POOL" | "PAYMENT_OVERDUE" | "DORMANT_CUSTOMER", `emailEnabled`?: boolean, `inAppEnabled`?: boolean
- **Returns:** `id`: string, `organizationId`: string, `membershipId`: string, `type`: string, `emailEnabled`: boolean, `inAppEnabled`: boolean, `pushEnabled`: boolean, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 404

## Notifications

### `GET …/me/notification-preferences`

`getMyNotificationPreferences`

Notification types for the caller's role, channels, presets, quiet hours and daily email limit

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `preset`: "EVERYTHING" | "IMPORTANT_ONLY" | "OFF" | "CUSTOM", `presets`: object[], `types`: object[], `quietHours`: object, `dailyEmailCap`: number, `dailyEmailCapRange`: object, `emailsToday`: number, `heldForDigest`: number
- **Errors:** 401, 403

### `PATCH …/me/notification-preferences`

`updateMyNotificationPreferences`

Change notification preferences; overdue alerts cannot be turned off and push is not available yet

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `preset`?: "EVERYTHING" | "IMPORTANT_ONLY" | "OFF", `types`?: object, `quietHours`?: object, `dailyEmailCap`?: number
- **Returns:** `preset`: "EVERYTHING" | "IMPORTANT_ONLY" | "OFF" | "CUSTOM", `presets`: object[], `types`: object[], `quietHours`: object, `dailyEmailCap`: number, `dailyEmailCapRange`: object, `emailsToday`: number, `heldForDigest`: number
- **Errors:** 400, 401, 403

### `GET …/notifications`

`listNotifications`

Notification centre: paged, filter by type, unread and archived; never reveals a record the caller cannot open

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Query:** `unreadOnly`?: "true" | "false", `archived`?: "true" | "false", `type`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `unreadCount`: number
- **Errors:** 400, 401

### `POST …/notifications/{notificationId}/archive`

`archiveNotification`

Archive a notification (DELETE on the same path restores it)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `updated`: number
- **Errors:** 401, 404

### `DELETE …/notifications/{notificationId}/archive`

`deleteNotificationsByNotificationIdArchive` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `updated`: number
- **Errors:** 401, 404

### `POST …/notifications/{notificationId}/read`

`postNotificationsByNotificationIdRead` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `count`: number
- **Errors:** 401, 404

### `POST …/notifications/mark-all-read`

`postNotificationsMarkAllRead` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `count`: number
- **Errors:** 401, 404

### `GET …/notifications/unread-count`

`getUnreadNotificationCount`

The bell badge: unread notifications this caller can open

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `unreadCount`: number
- **Errors:** 401

## Operations

### `GET /api/cron/jobs`

`runJobsGet`

Scheduler entry point: queue the current slot of every scheduled job, recover crashed jobs, run due jobs. Bearer CRON_SECRET.

- **Credential:** cronSecret
- **Returns:** object
- **Errors:** 401

### `POST /api/cron/jobs`

`runJobsPost`

Same as the GET form, for schedulers that can only POST.

- **Credential:** cronSecret
- **Returns:** object
- **Errors:** 401

### `GET /api/cron/notifications-sweep`

`runNotificationsSweepGet`

Run the notifications sweep now. Bearer CRON_SECRET.

- **Credential:** cronSecret
- **Returns:** object
- **Errors:** 401

### `POST /api/cron/notifications-sweep`

`runNotificationsSweepPost`

Same as the GET form, for schedulers that can only POST.

- **Credential:** cronSecret
- **Returns:** object
- **Errors:** 401

### `GET /api/health`

`getHealth`

Liveness and database reachability, with the last notifications sweep. No authentication.

- **Credential:** none (public)
- **Returns:** object
- **Errors:** 503

## Organisation

### `GET …/look`

`getOrganizationLook`

How the organisation looks: name, logo, default theme and page colour (every member can read)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `name`: string, `shownName`: string, `displayName`: string | null, `logoUrl`: string | null, `defaultTheme`: string, `defaultPageColour`: string, `colours`: object, `showLogoOnClientPages`: boolean, `allowPersonalisation`: boolean
- **Errors:** 401, 403

### `PATCH …/look`

`updateOrganizationLook`

Change the organisation's look and whether members may personalise (Management only)

- **Credential:** sessionCookie; **access:** management
- **Body:** `displayName`?: string | null, `logoFileId`?: string | null, `defaultTheme`?: string, `defaultPageColour`?: string, `showLogoOnClientPages`?: boolean, `allowPersonalisation`?: boolean
- **Returns:** `name`: string, `shownName`: string, `displayName`: string | null, `logoUrl`: string | null, `defaultTheme`: string, `defaultPageColour`: string, `colours`: object, `showLogoOnClientPages`: boolean, `allowPersonalisation`: boolean
- **Errors:** 400, 401, 403, 404

## PWA

### `GET …/pwa/manifest`

`getPwaManifest`

The web app manifest for this organisation (its name and colours)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** object
- **Errors:** 401

### `GET …/pwa/version`

`getPwaVersion`

The cache version an installed app compares with its own, and what may be queued offline

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** object
- **Errors:** 401

## Payments

### `GET …/deals/{dealId}/payment-note`

`getDealPaymentNote`

The next follow-up note on a won deal (Finance and Management)

- **Credential:** sessionCookie; **access:** management, finance
- **Returns:** `note`: object | null
- **Errors:** 401, 403, 404

### `PUT …/deals/{dealId}/payment-note`

`setDealPaymentNote`

Set the note with an owner and a date

- **Credential:** sessionCookie; **access:** management, finance
- **Body:** `note`: string, `ownerMembershipId`?: string | null, `nextOn`?: string | null
- **Returns:** `note`: string
- **Errors:** 400, 401, 403, 404

### `DELETE …/deals/{dealId}/payment-note`

`clearDealPaymentNote`

Clear the note

- **Credential:** sessionCookie; **access:** management, finance
- **Returns:** `cleared`: boolean
- **Errors:** 401, 403, 404

### `GET …/invoices`

`listInvoices`

Payments tracker list with totals by status (Finance and Management only). Overdue is derived from the due date.

- **Credential:** sessionCookie; **access:** management, finance
- **Query:** `status`?: string, `overdue`?: "true" | "false", `companyId`?: string, `dealId`?: string, `dueFrom`?: string, `dueTo`?: string, `q`?: string, `sort`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null, `totals`: object
- **Errors:** 400, 401, 403

### `POST …/invoices`

`createInvoice`

Create an invoice for a company or a won deal. Status only: nothing is processed.

- **Credential:** sessionCookie; **access:** management, finance
- **Body:** `number`: string, `amount`: number | string, `currency`?: string, `issuedOn`: string, `dueOn`: string, `companyId`?: string, `dealId`?: string, `recurringServiceId`?: string, `notes`?: string, `sent`?: boolean
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean
- **Errors:** 400, 401, 403, 404, 409, 422

### `GET …/invoices/{invoiceId}`

`getInvoice`

One invoice with its payments

- **Credential:** sessionCookie; **access:** management, finance
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean, `payments`: object[]
- **Errors:** 401, 403, 404

### `PATCH …/invoices/{invoiceId}`

`updateInvoice`

Edit an invoice (audited before and after); the amount cannot fall below what was received

- **Credential:** sessionCookie; **access:** management, finance
- **Body:** `number`?: string, `amount`?: number | string, `dueOn`?: string, `issuedOn`?: string, `notes`?: string | null
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/invoices/{invoiceId}/payments`

`recordPayment`

Record money received. The sum can never exceed the invoice unless `allowOverpayment` is sent.

- **Credential:** sessionCookie; **access:** management, finance
- **Body:** `amount`: number | string, `paidOn`?: string, `methodLabel`?: string, `reference`?: string, `allowOverpayment`?: boolean
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean
- **Errors:** 400, 401, 403, 404, 422

### `POST …/invoices/{invoiceId}/send`

`markInvoiceSent`

Draft to sent; already sent comes back unchanged

- **Credential:** sessionCookie; **access:** management, finance
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean
- **Errors:** 400, 401, 403, 404

### `POST …/invoices/{invoiceId}/void`

`voidInvoice`

Void with a reason; refused while payments are recorded against it

- **Credential:** sessionCookie; **access:** management, finance
- **Body:** `reason`: string
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/invoices/export`

`exportInvoices`

CSV of the invoices matching the list filters (Finance and Management; over 500 rows needs export.bulk)

- **Credential:** sessionCookie; **access:** management, finance
- **Query:** `status`?: string, `overdue`?: "true" | "false", `companyId`?: string, `dealId`?: string, `dueFrom`?: string, `dueTo`?: string, `q`?: string
- **Returns:** string
- **Errors:** 401, 403

### `POST …/payments/{paymentId}/reverse`

`reversePayment`

Reverse a payment recorded by mistake, with a reason; the record stays

- **Credential:** sessionCookie; **access:** management, finance
- **Body:** `reason`: string
- **Returns:** `id`: string, `number`: string, `status`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID", `storedStatus`: "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID", `dealId`: string | null, `companyId`: string, `companyName`: string, `amount`: string, `currency`: string, `paidAmount`: string, `balance`: string, `overpaid`: string, `overdue`: boolean, `daysOverdue`: number, `issuedOn`: string, `dueOn`: string, `allowOverpayment`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/payments/deals`

`listWonDealPayments`

Won deals with invoiced and received totals and the next follow-up note

- **Credential:** sessionCookie; **access:** management, finance
- **Query:** `companyId`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 401, 403

### `GET …/payments/summary`

`getPaymentSummary`

Due this week, overdue, collected this month, still owing

- **Credential:** sessionCookie; **access:** management, finance
- **Returns:** `dueThisWeek`: object, `overdue`: object, `collectedThisMonth`: object, `outstanding`: string, `nothingToCollect`: boolean
- **Errors:** 401, 403

## Preferences

### `GET …/me/preferences`

`getMyPreferences`

Own preferences: appearance, start page, sidebar, date and time, with the device-only defaults

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `appearance`: object, `personalisation`: object, `startPage`: object, `sidebar`: object, `regional`: object, `deviceOnly`: object, `catalogue`: object, `undoAvailable`: boolean
- **Errors:** 401, 403

### `PATCH …/me/preferences`

`updateMyPreferences`

Change own preferences; look fields are ignored (and listed in `ignored`) while the organisation has personalisation off

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `theme`?: string, `pageColour`?: string, `toggle`?: object, `density`?: string, `startPage`?: string | null, `sidebar`?: object, `hourFormat`?: string, `firstDayOfWeek`?: string, `dateFormat`?: string, `ownColours`?: object | null
- **Returns:** `appearance`: object, `personalisation`: object, `startPage`: object, `sidebar`: object, `regional`: object, `deviceOnly`: object, `catalogue`: object, `undoAvailable`: boolean, `ignored`: string[]
- **Errors:** 400, 401, 403

### `POST …/me/preferences/reset`

`resetMyAppearance`

Back to Forest on White; returns a one-time undo token valid for ten minutes

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `preferences`: object, `undo`: object
- **Errors:** 401, 403

### `POST …/me/preferences/undo`

`undoMyReset`

Restore the look from before the last reset (single use)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `token`: string
- **Returns:** `appearance`: object, `personalisation`: object, `startPage`: object, `sidebar`: object, `regional`: object, `deviceOnly`: object, `catalogue`: object, `undoAvailable`: boolean
- **Errors:** 400, 401, 403

## Profile

### `POST …/me/avatar`

`setMyAvatar`

Use an uploaded picture: cropped, resized to 256px and re-encoded as WebP; the original is deleted

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `fileId`: string, `crop`?: object | null
- **Returns:** `membershipId`: string, `userId`: string, `name`: string, `email`: string, `phone`: string | null, `timeZone`: string | null, `organizationTimeZone`: string, `effectiveTimeZone`: string, `avatar`: object
- **Errors:** 400, 401, 403, 404

### `DELETE …/me/avatar`

`removeMyAvatar`

Remove the picture (initials are shown instead)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `membershipId`: string, `userId`: string, `name`: string, `email`: string, `phone`: string | null, `timeZone`: string | null, `organizationTimeZone`: string, `effectiveTimeZone`: string, `avatar`: object
- **Errors:** 401, 403

### `GET …/me/profile`

`getMyProfile`

The signed-in person's profile: name, phone, time zone and picture

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `membershipId`: string, `userId`: string, `name`: string, `email`: string, `phone`: string | null, `timeZone`: string | null, `organizationTimeZone`: string, `effectiveTimeZone`: string, `avatar`: object
- **Errors:** 401, 403

### `PATCH …/me/profile`

`updateMyProfile`

Change own name, phone or time zone

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `name`?: string, `phone`?: string | null, `timeZone`?: string | null
- **Returns:** `membershipId`: string, `userId`: string, `name`: string, `email`: string, `phone`: string | null, `timeZone`: string | null, `organizationTimeZone`: string, `effectiveTimeZone`: string, `avatar`: object
- **Errors:** 400, 401, 403

### `GET …/profile`

`getProfile` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `name`: string, `timezone`: string, `defaultCurrency`: string, `phone`?: null, `website`?: null, `address`?: null, `workingDays`: string[], `workingHoursStart`?: null, `workingHoursEnd`?: null
- **Errors:** 401, 403, 404

### `PATCH …/profile`

`patchProfile` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`?: string, `timezone`?: string, `defaultCurrency`?: string, `phone`?: string | null, `website`?: string | null, `address`?: string | null, `workingDays`?: string[], `workingHoursStart`?: string | null, `workingHoursEnd`?: string | null
- **Returns:** `name`: string, `timezone`: string, `defaultCurrency`: string, `phone`?: null, `website`?: null, `address`?: null, `workingDays`: string[], `workingHoursStart`?: null, `workingHoursEnd`?: null
- **Errors:** 400, 401, 403, 404

## Public

### `POST /api/public/orgs/{orgSlug}/communications/inbound`

`ingestInboundEmail` · rate limited

Inbound email (BCC-to-CRM) webhook. Authenticated by the organisation's inbound token in a header or the `token` query parameter.

- **Credential:** inboundEmailKey
- **Body:** `from`: string, `subject`?: string, `text`?: string, `messageId`?: string
- **Returns:** object
- **Errors:** 400, 401, 429

### `POST /api/public/orgs/{orgSlug}/leads`

`submitWebsiteLead` · rate limited

Website lead capture. Authenticated by the organisation's website key in `x-figbloom-api-key`; rate limited per IP and per key; optional origin allow-list, honeypot and captcha.

- **Credential:** websiteApiKey
- **Body:** JSON object
- **Returns:** object
- **Errors:** 400, 401, 403, 413, 429

## Push

### `GET …/push/config`

`getPushConfig`

Whether Web Push is on for this server, and the public key to subscribe with

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** object
- **Errors:** 401

### `GET …/push/subscriptions`

`listMyPushSubscriptions`

The caller's registered devices

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** object
- **Errors:** 401

### `POST …/push/subscriptions`

`registerPushSubscription`

Register this browser or phone for push (endpoint must be on a real push service, over https)

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `endpoint`: string, `keys`: object, `userAgent`?: string
- **Returns:** object
- **Errors:** 400, 401

### `DELETE …/push/subscriptions/{subscriptionId}`

`removeMyPushSubscription`

Stop sending push to one of the caller's own devices

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** object
- **Errors:** 401, 404

## Quick capture

### `POST …/quick-capture`

`quickCapture`

Capture a lead in seconds. A likely duplicate answers 200 DUPLICATE_WARNING and creates nothing; resend with duplicateDecision to open the existing record, create anyway or merge.

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `name`: string, `phone`?: string, `email`?: string, `company`?: string, `serviceId`?: string, `sourceId`?: string, `note`?: string, `followUp`?: object, `duplicateDecision`?: "OPEN_EXISTING" | "CREATE_ANYWAY" | "MERGE", `duplicateId`?: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

## Reference Catalogs

### `GET …/reference-catalogs/{catalogKey}`

`getReferenceCatalogsByCatalogKey` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** object[]
- **Errors:** 401, 403, 404

### `POST …/reference-catalogs/{catalogKey}`

`postReferenceCatalogsByCatalogKey` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`: string, `description`?: string, `probability`?: number, `isWon`?: boolean, `isLost`?: boolean, `category`?: string
- **Returns:** `id`: string, `organizationId`: string, `key`: string, `name`: string, `description`?: null, `sequence`: number, `isActive`: boolean, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `POST …/reference-catalogs/{catalogKey}/{entryId}`

`postReferenceCatalogsByCatalogKeyByEntryId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** JSON object
- **Returns:** `id`: string, `organizationId`: string, `key`: string, `name`: string, `description`?: null, `sequence`: number, `isActive`: boolean, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `POST …/reference-catalogs/{catalogKey}/{entryId}/move`

`postReferenceCatalogsByCatalogKeyByEntryIdMove` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `direction`: "up" | "down"
- **Returns:** `ok`: boolean
- **Errors:** 400, 401, 403, 404

## Reference Data

### `GET …/reference-data`

`getReferenceData` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `leadSources`: object[], `leadStatuses`: object[], `pipelineStages`: object[], `lifecycleStates`: object[], `lostReasons`: object[], `services`: object[], `members`: object[]
- **Errors:** 401, 404

## Reference data

### `GET …/reference-admin`

`listReferenceKinds`

The reference lists the caller may manage and what each allows

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `items`: object[]
- **Errors:** 401, 403

### `GET …/reference-admin/{kind}`

`listReferenceValues`

Every value of one list, hidden ones included, with its usage count

- **Credential:** sessionCookie; **access:** management
- **Returns:** `items`: object[]
- **Errors:** 401, 403, 404

### `POST …/reference-admin/{kind}`

`createReferenceValue`

Add a value. Extras depend on the list (category, colour, subject and body, entityType and key).

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `GET …/reference-admin/{kind}/{valueId}`

`getReferenceValueUsage`

How many records use a value and what holds them

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403, 404

### `PATCH …/reference-admin/{kind}/{valueId}`

`updateReferenceValue`

Rename and/or hide or unhide. A hidden value stays on its records and leaves the pickers.

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`?: string, `hidden`?: boolean
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `DELETE …/reference-admin/{kind}/{valueId}`

`deleteReferenceValue`

Delete an unused value. A used one is refused with the usage and the advice to hide it.

- **Credential:** sessionCookie; **access:** management
- **Returns:** object
- **Errors:** 401, 403, 404

### `POST …/reference-admin/{kind}/{valueId}/merge`

`mergeReferenceValues`

Merge this value into another: everything re-points, this one is removed, audited

- **Credential:** sessionCookie; **access:** management
- **Body:** `intoId`: string
- **Returns:** object
- **Errors:** 400, 401, 403, 404

### `POST …/reference-admin/{kind}/{valueId}/reorder`

`reorderReferenceValue`

Move a value up or down

- **Credential:** sessionCookie; **access:** management
- **Body:** `direction`: "up" | "down"
- **Returns:** `items`: object[]
- **Errors:** 400, 401, 403, 404

## Reminders

### `GET …/reminder-settings`

`getReminderSettings`

Automatic reminders: each rule's switch and threshold (Management)

- **Credential:** sessionCookie; **access:** management
- **Returns:** `proposalFollowUp`: object
- **Errors:** 401, 403

### `PUT …/reminder-settings`

`updateReminderSettings`

Switch rules on or off and set their thresholds. Reminders only tell people; they never decide anything.

- **Credential:** sessionCookie; **access:** management
- **Body:** `proposalFollowUp`?: object, `renewal`?: object, `dormant`?: object, `overdueInvoices`?: object
- **Returns:** `proposalFollowUp`: object
- **Errors:** 400, 401, 403

## Renewals

### `GET …/recurring-services`

`listRecurringServices`

Recurring services with their derived renewal state; the value is masked like a deal's

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `companyId`?: string, `state`?: string, `ownerMembershipId`?: string, `serviceId`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`: string | null
- **Errors:** 400, 401, 403

### `POST …/recurring-services`

`createRecurringService`

Add a recurring service for a company

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `companyId`: string, `serviceId`: string, `billingCycle`?: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`?: number | string | null, `currency`?: string, `startsOn`: string, `renewsOn`: string, `ownerMembershipId`?: string | null, `autoRenew`?: boolean, `notes`?: string | null
- **Returns:** `id`: string, `companyId`: string, `companyName`: string, `serviceName`: string, `billingCycle`: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`: string | null, `valueMasked`: boolean, `renewsOn`: string, `daysToRenewal`: number, `state`: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED", `stateSource`: "rule" | "override"
- **Errors:** 400, 401, 403, 404, 422

### `GET …/recurring-services/{serviceId}`

`getRecurringService`

One recurring service

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `id`: string, `companyId`: string, `companyName`: string, `serviceName`: string, `billingCycle`: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`: string | null, `valueMasked`: boolean, `renewsOn`: string, `daysToRenewal`: number, `state`: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED", `stateSource`: "rule" | "override"
- **Errors:** 401, 403, 404

### `PATCH …/recurring-services/{serviceId}`

`updateRecurringService`

Edit a recurring service

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `billingCycle`?: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`?: number | string | null, `startsOn`?: string, `renewsOn`?: string, `ownerMembershipId`?: string | null, `autoRenew`?: boolean, `notes`?: string | null
- **Returns:** `id`: string, `companyId`: string, `companyName`: string, `serviceName`: string, `billingCycle`: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`: string | null, `valueMasked`: boolean, `renewsOn`: string, `daysToRenewal`: number, `state`: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED", `stateSource`: "rule" | "override"
- **Errors:** 400, 401, 403, 404

### `POST …/recurring-services/{serviceId}/cancel`

`cancelRecurringService`

Cancel with a reason

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `reason`: string
- **Returns:** `id`: string, `companyId`: string, `companyName`: string, `serviceName`: string, `billingCycle`: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`: string | null, `valueMasked`: boolean, `renewsOn`: string, `daysToRenewal`: number, `state`: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED", `stateSource`: "rule" | "override"
- **Errors:** 400, 401, 403, 404

### `POST …/recurring-services/{serviceId}/renew`

`renewRecurringService`

Renew for the next period; optionally also create a renewal task and a draft invoice

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `task`?: object, `invoice`?: object
- **Returns:** `service`: object, `taskId`: string | null, `invoiceId`: string | null
- **Errors:** 400, 401, 403, 404, 422

### `PUT …/recurring-services/{serviceId}/state`

`overrideRenewalState`

Override the derived state with a reason, or send state null to hand it back to the dates

- **Credential:** sessionCookie; **access:** management, sales
- **Body:** `state`: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | null, `reason`?: string
- **Returns:** `id`: string, `companyId`: string, `companyName`: string, `serviceName`: string, `billingCycle`: "MONTHLY" | "QUARTERLY" | "YEARLY", `value`: string | null, `valueMasked`: boolean, `renewsOn`: string, `daysToRenewal`: number, `state`: "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED", `stateSource`: "rule" | "override"
- **Errors:** 400, 401, 403, 404

### `GET …/renewal-settings`

`getRenewalSettings`

The due window and the lapse grace

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `dueSoonDays`: number, `graceDays`: number
- **Errors:** 401, 403

### `PUT …/renewal-settings`

`updateRenewalSettings`

Change the due window and the lapse grace (Management)

- **Credential:** sessionCookie; **access:** management
- **Body:** `dueSoonDays`?: number, `graceDays`?: number
- **Returns:** `dueSoonDays`: number, `graceDays`: number
- **Errors:** 400, 401, 403

### `GET …/retention`

`getRenewalsAndRetention`

Renewals and retention: LAPSED, DUE_30, UNANSWERED_PROPOSALS, GOING_QUIET, CROSS_SELL. A customer is in exactly one list; counts match the lists.

- **Credential:** sessionCookie; **access:** management, sales
- **Query:** `list`?: string, `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `scope`: "organisation" | "own", `counts`: object, `total`: number, `lists`: object
- **Errors:** 400, 401, 403

## Reports

### `GET …/reports/customers`

`getReportsCustomers` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Query:** `dormantAfterDays`?: string, `segment`?: "active" | "repeat" | "dormant", `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `dormancyDays`: number, `summary`: object, `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null, `valueMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/reports/customers-export`

`getReportsCustomersExport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Query:** `dormantAfterDays`?: string, `withinDays`?: string, `dateFrom`?: string, `dateTo`?: string, `period`?: "total" | "month"
- **Returns:** CSV
- **Errors:** 400, 401, 403, 404

### `GET …/reports/export`

`getReportsExport` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** CSV
- **Errors:** 401, 403, 404

### `GET …/reports/my-metrics`

`getReportsMyMetrics` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `scope`: object, `dateFrom`: string, `dateTo`: string, `leadVolumeBySource`: object[], `leadConversion`: object, `dealOutcomes`: object, `pipelineByStage`: object[], `salesByService`: any[], `followUpBreakdown`: object[], `valueMasked`: boolean
- **Errors:** 401, 403, 404

### `GET …/reports/my-work`

`getReportsMyWork` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Returns:** `dueToday`: any[], `overdue`: any[], `newLeads`: object[], `stalledDeals`: any[]
- **Errors:** 401, 403, 404

### `GET …/reports/organization`

`getReportsOrganization` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `dateFrom`: string, `dateTo`: string, `leadVolumeBySource`: object[], `leadConversion`: object, `dealOutcomes`: object, `pipelineByStage`: object[], `salesByService`: any[], `followUpBreakdown`: object[], `valueMasked`: boolean
- **Errors:** 401, 403, 404

### `GET …/reports/renewals`

`getReportsRenewals` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Query:** `withinDays`?: string, `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `withinDays`: number, `summary`: object, `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `GET …/reports/sales-by-salesperson`

`getReportsSalesBySalesperson` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `ownerMembershipId`?: string, `serviceId`?: string, `dateFrom`?: string, `dateTo`?: string, `period`?: "total" | "month"
- **Returns:** `dateFrom`: string, `dateTo`: string, `period`: string, `rows`: any[], `valueMasked`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/reports/settings`

`getReportsSettings` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `dormancyDays`: number
- **Errors:** 401, 403, 404

### `PUT …/reports/settings`

`putReportsSettings` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `dormancyDays`: number
- **Returns:** `dormancyDays`: number
- **Errors:** 400, 401, 403, 404

### `GET …/reports/v2`

`getReportsV2`

Every organisation report as a table with chart series from the same rows (Management)

- **Credential:** sessionCookie; **access:** management
- **Query:** `dateFrom`?: string, `dateTo`?: string
- **Returns:** `reports`: object[]
- **Errors:** 400, 401, 403

### `GET …/reports/v2/{report}`

`getReportV2`

One report: LEAD_SOURCES, CONVERSION_BY_SOURCE, CONVERSION_BY_STAGE, PIPELINE_BY_STAGE, LOST_REASONS, PER_PERSON, MONTH_VS_LAST, CUSTOMERS or RENEWALS

- **Credential:** sessionCookie; **access:** management
- **Query:** `dateFrom`?: string, `dateTo`?: string
- **Returns:** `key`: string, `title`: string, `definition`: string, `scope`: "organisation" | "own", `valueMasked`: boolean, `chart`: object, `table`: object
- **Errors:** 400, 401, 403

### `GET …/reports/v2/{report}/export`

`exportReportV2`

CSV of one report: the same table; above the bulk-export limit it needs export.bulk

- **Credential:** sessionCookie; **access:** management
- **Query:** `dateFrom`?: string, `dateTo`?: string
- **Returns:** string
- **Errors:** 400, 401, 403

### `GET …/reports/v2/my-metrics`

`getMyMetricsV2`

My metrics: the caller's own figures only, as cards and a table

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `dateFrom`?: string, `dateTo`?: string
- **Returns:** `key`: string, `title`: string, `definition`: string, `scope`: "organisation" | "own", `valueMasked`: boolean, `chart`: object, `table`: object, `cards`: object[]
- **Errors:** 400, 401, 403

### `GET …/reports/v2/my-metrics/export`

`exportMyMetrics`

CSV of My metrics

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `dateFrom`?: string, `dateTo`?: string
- **Returns:** string
- **Errors:** 401, 403

## Scoring

### `GET …/scoring/weights`

`getScoringWeights` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `lead`: object, `health`: object, `min`: number, `max`: number
- **Errors:** 401, 403, 404

### `PATCH …/scoring/weights`

`patchScoringWeights` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `lead`?: object, `health`?: object
- **Returns:** `lead`: object, `health`: object, `min`: number, `max`: number
- **Errors:** 400, 401, 403, 404

## Search

### `GET …/search`

`search`

Global search: groups with totals, paged per group (`type` + `page`), archived only on request, phone numbers in any format

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Query:** `q`: string, `type`?: "companies" | "contacts" | "leads" | "deals" | "tasks", `archived`?: "exclude" | "include" | "only", `page`?: string, `pageSize`?: string, `cursor`?: string
- **Returns:** `query`: string, `tooShort`: boolean, `total`: number, `groups`: object[], `hidden`: object
- **Errors:** 400, 401

### `GET …/search/recents`

`getSearchRecents` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `recents`: any[]
- **Errors:** 401, 404

### `POST …/search/recents`

`postSearchRecents` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `query`: string
- **Returns:** `recents`: object[]
- **Errors:** 400, 401, 404

### `DELETE …/search/recents`

`deleteSearchRecents` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** `cleared`: number
- **Errors:** 401, 404

## Security

### `GET …/security/session-policy`

`getSecuritySessionPolicy` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `lifetimeHours`: number, `options`: number[], `defaultHours`: number, `maxAbsoluteHours`: number, `warnSecondsBeforeExpiry`: number
- **Errors:** 401, 403, 404

### `PATCH …/security/session-policy`

`patchSecuritySessionPolicy` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `lifetimeHours`: number
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/security/sign-in-events`

`getSecuritySignInEvents` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Query:** `membershipId`?: string, `outcome`?: "SUCCESS" | "FAILURE" | "LOCKOUT" | "NEW_DEVICE", `from`?: string, `to`?: string, `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

## Session

### `GET /api/session`

`getSession`

The current session: who is signed in and when it expires.

- **Credential:** sessionCookie
- **Returns:** object
- **Errors:** 401

### `POST /api/session/extend`

`extendSession`

Extend the session's idle expiry (up to the absolute limit).

- **Credential:** sessionCookie
- **Returns:** object
- **Errors:** 401

## Settings

### `GET …/settings/overview`

`getSettingsOverview`

Settings landing page: profile, member counts by state, integration states (Management)

- **Credential:** sessionCookie; **access:** management
- **Returns:** `profile`: object, `members`: object, `integrations`: object
- **Errors:** 401, 403

## Sync

### `POST …/sync/batch`

`applySyncBatch`

The offline queue: up to 100 actions, each with a client id; answered APPLIED, DUPLICATE, CONFLICT or REJECTED per item. Replaying a batch changes nothing. Stage and ownership are server-wins.

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Body:** `mutations`: object[]
- **Returns:** `results`: object[], `counts`: object, `processedOrder`: number[]
- **Errors:** 400, 401, 403

### `GET …/sync/status`

`getSyncStatus`

The caller's queue as the server sees it: last sync, last seven days, what needs attention

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance, restricted technical, customer support
- **Returns:** object
- **Errors:** 401

## Tags

### `GET …/tags`

`getTags` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, finance
- **Query:** `q`?: string, `includeHidden`?: "true" | "false"
- **Returns:** `items`: object[]
- **Errors:** 400, 401, 403, 404

### `POST …/tags`

`postTags` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`: string, `colour`?: string
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `colour`: string, `isActive`: boolean, `createdByMembershipId`: string, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `PATCH …/tags/{tagId}`

`patchTagsByTagId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`?: string, `colour`?: string
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `colour`: string, `isActive`: boolean, `createdByMembershipId`: string, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `DELETE …/tags/{tagId}`

`deleteTagsByTagId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** `id`: string
- **Errors:** 401, 403, 404

### `POST …/tags/{tagId}/merge`

`postTagsByTagIdMerge` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `intoTagId`: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

## Tasks

### `GET …/tasks`

`getTasks` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Query:** `status`?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string, `overdueOnly`?: "true" | "false", `includeArchived`?: "true" | "false", `archivedOnly`?: "true" | "false", `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `items`: object[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/tasks`

`postTasks` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Body:** `title`: string, `description`?: string, `requirements`?: string, `assigneeMembershipId`?: string, `dueAt`?: string, `priority`?: "LOW" | "MEDIUM" | "HIGH", `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string
- **Returns:** `id`: string, `organizationId`: string, `title`: string, `description`?: null, `requirements`?: null, `assigneeMembershipId`: string, `createdByMembershipId`: string, `dueAt`?: null, `priority`: string, `status`: string, `completedAt`?: null, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `companyId`?: null, `contactId`?: null, `leadId`?: null, `dealId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `GET …/tasks/{taskId}`

`getTasksByTaskId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `id`: string, `organizationId`: string, `title`: string, `description`?: null, `requirements`?: null, `assigneeMembershipId`: string, `createdByMembershipId`: string, `dueAt`: string, `priority`: string, `status`: string, `completedAt`?: null, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `companyId`?: null, `contactId`?: null, `leadId`: string, `dealId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 401, 403, 404

### `PATCH …/tasks/{taskId}`

`patchTasksByTaskId` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Body:** `title`?: string, `description`?: string | null, `requirements`?: string | null, `assigneeMembershipId`?: string, `dueAt`?: string | null, `priority`?: "LOW" | "MEDIUM" | "HIGH", `status`?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
- **Returns:** `id`: string, `organizationId`: string, `title`: string, `description`?: null, `requirements`?: null, `assigneeMembershipId`: string, `createdByMembershipId`: string, `dueAt`: string, `priority`: string, `status`: string, `completedAt`?: null, `archivedAt`?: null, `archivedByMembershipId`?: null, `archiveReason`?: null, `companyId`?: null, `contactId`?: null, `leadId`: string, `dealId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `POST …/tasks/{taskId}/archive`

`postTasksByTaskIdArchive` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Body:** `reason`?: string
- **Returns:** `id`: string, `organizationId`: string, `title`: string, `description`?: null, `requirements`?: null, `assigneeMembershipId`: string, `createdByMembershipId`: string, `dueAt`: string, `priority`: string, `status`: string, `completedAt`?: null, `archivedAt`: string, `archivedByMembershipId`: string, `archiveReason`?: null, `companyId`?: null, `contactId`?: null, `leadId`: string, `dealId`?: null, `createdAt`: string, `updatedAt`: string, `importSessionId`?: null
- **Errors:** 400, 401, 403, 404

### `GET …/tasks/{taskId}/attachments`

`getTasksByTaskIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `items`: any[]
- **Errors:** 401, 403, 404

### `POST …/tasks/{taskId}/attachments`

`postTasksByTaskIdAttachments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Body:** `name`: string, `mimeType`: string, `sizeBytes`: number, `checksumSha256`?: string, `title`?: string, `shared`?: boolean, `proposalReferenceId`?: string
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `GET …/tasks/{taskId}/comments`

`getTasksByTaskIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `comments`: any[], `following`: boolean
- **Errors:** 401, 403, 404

### `POST …/tasks/{taskId}/comments`

`postTasksByTaskIdComments` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Body:** `body`: string, `mentions`?: string[]
- **Returns:** `id`: string, `authorMembershipId`: string, `authorName`: string, `body`: string, `deleted`: boolean, `edited`: boolean, `editedAt`?: null, `createdAt`: string, `mentions`: any[], `canEdit`: boolean, `canDelete`: boolean
- **Errors:** 400, 401, 403, 404

### `GET …/tasks/{taskId}/comments/mentionable`

`getTasksByTaskIdCommentsMentionable` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `members`: object[]
- **Errors:** 401, 403, 404

### `POST …/tasks/{taskId}/follow`

`postTasksByTaskIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `DELETE …/tasks/{taskId}/follow`

`deleteTasksByTaskIdFollow` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** `following`: boolean
- **Errors:** 401, 403, 404

### `POST …/tasks/{taskId}/restore`

`postTasksByTaskIdRestore` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Returns:** any
- **Errors:** 401, 403, 404

### `GET …/tasks/groups`

`getTasksGroups` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Query:** `groups`?: string, `pageSize`?: string, `assigneeMembershipId`?: string, `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string, `q`?: string
- **Returns:** `timeZone`: string, `counts`: object, `groups`: object[]
- **Errors:** 400, 401, 403, 404

### `GET …/tasks/groups/{group}`

`getTasksGroupsByGroup` · *derived*

- **Credential:** sessionCookie; **access:** management, sales, delivery, restricted technical
- **Query:** `assigneeMembershipId`?: string, `companyId`?: string, `contactId`?: string, `leadId`?: string, `dealId`?: string, `q`?: string, `limit`?: string, `cursor`?: string, `sort`?: string, `page`?: string, `pageSize`?: string
- **Returns:** `key`: string, `label`: string, `count`: number, `items`: any[], `page`: number, `pageSize`: number, `total`: number, `pageCount`: number, `nextCursor`?: null
- **Errors:** 400, 401, 403, 404

## Website Lead Assignment Rules

### `GET …/website-lead-assignment-rules`

`getWebsiteLeadAssignmentRules` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Returns:** object[]
- **Errors:** 401, 403, 404

### `POST …/website-lead-assignment-rules`

`postWebsiteLeadAssignmentRules` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `name`: string, `leadSourceId`?: string | null, `serviceId`?: string | null, `assigneeMembershipId`?: string | null, `assigneeMembershipIds`?: string[]
- **Returns:** any
- **Errors:** 400, 401, 403, 404

### `POST …/website-lead-assignment-rules/{ruleId}`

`postWebsiteLeadAssignmentRulesByRuleId` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** JSON object
- **Returns:** `id`: string, `organizationId`: string, `name`: string, `leadSourceId`?: null, `serviceId`?: null, `assigneeMembershipId`: string, `assigneeMembershipIds`: any[], `lastAssignedMembershipId`?: null, `sequence`: number, `isActive`: boolean, `createdAt`: string, `updatedAt`: string
- **Errors:** 400, 401, 403, 404

### `POST …/website-lead-assignment-rules/{ruleId}/move`

`postWebsiteLeadAssignmentRulesByRuleIdMove` · *derived*

- **Credential:** sessionCookie; **access:** management
- **Body:** `direction`: "up" | "down"
- **Returns:** `ok`: boolean
- **Errors:** 400, 401, 403, 404
