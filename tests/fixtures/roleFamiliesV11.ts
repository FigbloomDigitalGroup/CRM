/**
 * The reviewed, human-written side of the V1.1 permission matrix (G2.01): which V1.1 areas each role may reach at all. Written from the
 * permission model in prisma/seedData.ts (PERMISSION_MIN_RELEASE and ROLE_PERMISSIONS), not from what the walk answered:
 *
 *   quotes.create             Management, Sales            quotes, quote settings (read), request approval
 *   quotes.approve            Management                   decide an approval
 *   catalogue.manage          Management                   change the catalogue; reading follows deal-value visibility (Management, Sales, Finance)
 *   forecast.view.all         Management                   organisation forecast and targets; Sales read their own
 *   cadences.manage           Management                   write sequences; anyone with tasks.create reads the active ones
 *   ai.use                    Management, Sales, Delivery, Finance   (not Restricted Technical)
 *   ai.configure              Management                   assistant settings (write) and its audit
 *   chat.view / chat.post     all five roles
 *   mail.use                  Management, Sales, Delivery  (not Finance, not Restricted Technical)
 *   meetings.schedule         Management, Sales, Delivery
 *   views.share               Management, Sales            (every role has its own saved views)
 *
 * The walk (tests/apiWalkV11.test.ts) records what every route does; tests/accessMatrixV11Rules.test.ts holds the recorded matrix to these
 * lists, so a route that opens an area to the wrong role fails even if the matrix is regenerated to match it.
 */
import { key, under } from "./roleFamilies";

/** V1.1 areas only Management may reach. */
export const V11_MANAGEMENT_ONLY: RegExp[] = [
  under("/approval-rules"),
  key("/approvals/{approvalId}/decision"),
  key("/assistant/audit"),
  key("/assistant/settings", "PUT"),
  key("/catalogue", "POST"),
  key("/catalogue/{itemId}", "PATCH"),
  key("/forecast/targets", "PUT"),
  key("/pipelines", "POST"),
  key("/pipelines/{pipelineId}", "PATCH"),
  under("/pipelines/{pipelineId}/stages"),
  key("/quote-settings", "PATCH"),
  key("/sequences", "POST"),
  key("/sequences/{sequenceId}", "PATCH|DELETE"),
  under("/web-forms"),
  key("/sequence-enrollments", "GET"),
  key("/integrations/connections/organization"),
  key("/chat/channels/{channelId}", "DELETE"),
];

/** Routes that show a quote's cost or margin: only the roles with the margin permission (Management in the seeded model). */
export const V11_COST_AND_MARGIN_ROUTES: RegExp[] = [key("/deals/{dealId}/margin"), under("/quotes/{quoteId}/margin")];

/** The routes of a V1 organisation that answer differently in a V1.1 organisation, with the reason. Empty: nothing that worked in V1 changed. */
export const V1_TO_V11_CHANGES: Record<string, string> = {};

/** What every signed-in member of a V1.1 organisation does for themselves: chat, their saved views, their own connections, help. */
const SELF_SERVICE_V11: RegExp[] = [
  under("/chat"),
  under("/views"),
  key("/commands"),
  under("/help"),
  key("/whats-new"),
  key("/support-requests", "POST"),
  key("/integrations/connections"),
  key("/integrations/connections/start"),
  under("/integrations/connections/{connectionId}"),
];

/** Anyone who can create tasks reads the active sequences (tasks.create: Sales, Delivery, Restricted Technical; not Finance). */
const SEQUENCE_READ: RegExp[] = [key("/sequences", "GET"), key("/sequences/{sequenceId}", "GET")];
const ASSISTANT: RegExp[] = [key("/assistant/ask"), key("/assistant/settings", "GET"), under("/assistant/proposals/{proposalId}"), key("/assistant/requests/{requestId}/feedback")];
const MAIL_AND_MEETINGS: RegExp[] = [under("/communications/mail"), under("/communications/meetings")];

export const V11_ROLE_FAMILIES: Record<"SALES" | "DELIVERY" | "FINANCE" | "RESTRICTED_TECHNICAL", RegExp[]> = {
  SALES: [
    ...SELF_SERVICE_V11,
    ...SEQUENCE_READ,
    ...ASSISTANT,
    ...MAIL_AND_MEETINGS,
    under("/quotes"),
    key("/deals/{dealId}/quote"),
    key("/deals/{dealId}/request-approval"),
    key("/quote-settings", "GET"),
    key("/catalogue", "GET"),
    key("/catalogue/{itemId}", "GET"),
    key("/approvals", "GET"),
    key("/approvals/{approvalId}", "GET"),
    key("/approvals/{approvalId}/cancel"),
    key("/forecast", "GET"),
    key("/forecast/targets", "GET"),
    key("/pipelines", "GET"),
    key("/pipelines/{pipelineId}", "GET"),
    under("/sequence-enrollments/{enrollmentId}"),
    key("/sequences/{sequenceId}/enrollments"),
    under("/quick-capture/cards"),
    key("/quick-capture/cards/{captureId}"),
  ],
  DELIVERY: [...SELF_SERVICE_V11, ...SEQUENCE_READ, ...ASSISTANT, ...MAIL_AND_MEETINGS, key("/pipelines", "GET"), key("/pipelines/{pipelineId}", "GET")],
  FINANCE: [...SELF_SERVICE_V11, key("/assistant/ask"), key("/assistant/settings", "GET"), under("/assistant/proposals/{proposalId}"), key("/catalogue", "GET"), key("/catalogue/{itemId}", "GET"), key("/pipelines", "GET"), key("/pipelines/{pipelineId}", "GET")],
  RESTRICTED_TECHNICAL: [...SELF_SERVICE_V11, ...SEQUENCE_READ],
};
