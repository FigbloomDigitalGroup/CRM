import { z } from "zod";
import { DealSchema } from "./dto/deals";
import {
  CreateLeadBodySchema,
  CreateLeadResponseSchema,
  ListLeadsQuerySchema,
  ListLeadsResponseSchema,
} from "./dto/leads";
import { ErrorEnvelopeSchema } from "./dto/common";
import { FeatureSnapshotSchema, UpdateFeaturesBodySchema } from "./dto/features";
import {
  CreateUploadBodySchema,
  CreateUploadResponseSchema,
  DownloadLinkResponseSchema,
  FileSchema,
} from "./dto/files";
import { MeContextSchema } from "./dto/meContext";
import { STAGE2_OPERATIONS } from "./stage2Operations";
import {
  ExtendSessionResponseSchema,
  MyProfileSchema,
  MySessionsResponseSchema,
  NotificationPreferencesViewSchema,
  OrganizationLookSchema,
  PreferencesViewSchema,
  ResetPreferencesResponseSchema,
  SessionSummarySchema,
  SetAvatarBodySchema,
  UndoResetBodySchema,
  UpdateMyProfileBodySchema,
  UpdateNotificationPreferencesBodySchema,
  UpdateOrganizationLookBodySchema,
  UpdatePreferencesBodySchema,
  UpdatePreferencesResponseSchema,
} from "./dto/stage1";
import { LEAD_SORT_FIELDS } from "../repositories/leads";

/**
 * The OpenAPI 3.1 document, generated from the same Zod schemas the routes
 * parse and check against (FIG-1014, B0.06). A route is in the document when
 * it is listed in `OPERATIONS`; converting a route means moving its schemas
 * to `src/api/dto/` and adding a line here. `npm run openapi:export` writes
 * the file (CI keeps it as an artifact) and `GET /api/openapi.json` serves it
 * outside production.
 */
export interface OperationDef {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  /** Query parameters (GET); a list also gets the standard page/sort/filter parameters. */
  query?: z.ZodObject;
  /** True for a list: adds `page`, `pageSize`, `limit`, `cursor` and `sort`. */
  list?: { sortFields: readonly string[] };
  body?: z.ZodType;
  response: z.ZodType;
  /** Documented as a `200` unless set. */
  successStatus?: number;
  /** A create endpoint that honours the `Idempotency-Key` header. */
  idempotent?: boolean;
  /** Error statuses this operation can return, beyond 500. */
  errors: (400 | 401 | 403 | 404 | 409 | 422 | 429 | 503)[];
  /** Replaces the generic text for a status where this operation means something more specific. */
  errorNotes?: Partial<Record<number, string>>;
}

const ORG = "/api/orgs/{orgSlug}";

export const OPERATIONS: OperationDef[] = [
  {
    method: "get",
    path: `${ORG}/leads`,
    operationId: "listLeads",
    summary: "List leads (paged; own or organisation scope by role)",
    tags: ["Leads"],
    query: ListLeadsQuerySchema,
    list: { sortFields: LEAD_SORT_FIELDS },
    response: ListLeadsResponseSchema,
    errors: [400, 401, 403],
  },
  {
    method: "post",
    path: `${ORG}/leads`,
    operationId: "createLead",
    summary: "Create a lead",
    tags: ["Leads"],
    body: CreateLeadBodySchema,
    response: CreateLeadResponseSchema,
    idempotent: true,
    errors: [400, 401, 403, 409, 422],
  },
  {
    method: "get",
    path: `${ORG}/deals/{dealId}`,
    operationId: "getDeal",
    summary: "Get one deal (value masked for roles without deals.view.value)",
    tags: ["Deals"],
    response: DealSchema,
    errors: [401, 403, 404],
  },
  {
    method: "get",
    path: `${ORG}/features`,
    operationId: "getFeatures",
    summary: "Release flags and organisation toggles, resolved for this organisation",
    tags: ["Features"],
    response: FeatureSnapshotSchema,
    errors: [401, 403],
  },
  {
    method: "patch",
    path: `${ORG}/features`,
    operationId: "updateFeatureToggles",
    summary: "Switch organisation toggles (Management only; audited)",
    tags: ["Features"],
    body: UpdateFeaturesBodySchema,
    response: FeatureSnapshotSchema,
    errors: [400, 401, 403],
  },
  {
    method: "post",
    path: `${ORG}/files`,
    operationId: "createFileUpload",
    summary: "Start a file upload: returns a short-lived signed link to send the bytes to",
    tags: ["Files"],
    body: CreateUploadBodySchema,
    response: CreateUploadResponseSchema,
    errors: [400, 401, 403],
  },
  {
    method: "post",
    path: `${ORG}/files/{fileId}/complete`,
    operationId: "completeFileUpload",
    summary: "Finish an upload: checks size, type, content and checksum, scans for malware, then makes the file ready",
    tags: ["Files"],
    response: FileSchema,
    errors: [400, 401, 404, 409, 503],
    errorNotes: { 409: "The file was quarantined by the malware scan.", 503: "The scanner is unavailable; retry." },
  },
  {
    method: "get",
    path: `${ORG}/files/{fileId}`,
    operationId: "getFile",
    summary: "A file's metadata (404 for a file the caller may not see)",
    tags: ["Files"],
    response: FileSchema,
    errors: [401, 404],
  },
  {
    method: "get",
    path: `${ORG}/files/{fileId}/download`,
    operationId: "getFileDownloadLink",
    summary: "A signed download link, valid for about a minute",
    tags: ["Files"],
    response: DownloadLinkResponseSchema,
    errors: [401, 404, 409],
    errorNotes: { 409: "The file is quarantined and cannot be downloaded." },
  },
  {
    method: "delete",
    path: `${ORG}/files/{fileId}`,
    operationId: "deleteFile",
    summary: "Delete a file (kept until the retention purge removes its bytes)",
    tags: ["Files"],
    response: FileSchema,
    errors: [401, 404],
  },
  // ---- Stage 1 foundation (B1.04 - B1.11)
  {
    method: "get",
    path: "/api/me/context",
    operationId: "getMyContext",
    summary: "Everything the shell needs to draw itself, in one shape for every role (sections that do not apply are null)",
    tags: ["Me"],
    query: z.object({ org: z.string().optional() }),
    response: MeContextSchema,
    errors: [401, 404],
    errorNotes: { 404: "`org` names an organisation the caller does not belong to." },
  },
  {
    method: "get",
    path: "/api/session",
    operationId: "getSession",
    summary: "The current session's time left and when to warn",
    tags: ["Sessions"],
    response: SessionSummarySchema,
    errors: [401, 404],
  },
  {
    method: "post",
    path: "/api/session/extend",
    operationId: "extendSession",
    summary: "Stay signed in: extend the session by one policy period, never past the absolute ceiling",
    tags: ["Sessions"],
    response: ExtendSessionResponseSchema,
    errors: [401, 404],
  },
  {
    method: "get",
    path: "/api/me/sessions",
    operationId: "listMySessions",
    summary: "Every device the person is signed in on",
    tags: ["Sessions"],
    response: MySessionsResponseSchema,
    errors: [401, 403],
  },
  {
    method: "get",
    path: `${ORG}/me/profile`,
    operationId: "getMyProfile",
    summary: "The signed-in person's profile: name, phone, time zone and picture",
    tags: ["Profile"],
    response: MyProfileSchema,
    errors: [401, 403],
  },
  {
    method: "patch",
    path: `${ORG}/me/profile`,
    operationId: "updateMyProfile",
    summary: "Change own name, phone or time zone",
    tags: ["Profile"],
    body: UpdateMyProfileBodySchema,
    response: MyProfileSchema,
    errors: [400, 401, 403],
  },
  {
    method: "post",
    path: `${ORG}/me/avatar`,
    operationId: "setMyAvatar",
    summary: "Use an uploaded picture: cropped, resized to 256px and re-encoded as WebP; the original is deleted",
    tags: ["Profile"],
    body: SetAvatarBodySchema,
    response: MyProfileSchema,
    errors: [400, 401, 403, 404],
  },
  {
    method: "delete",
    path: `${ORG}/me/avatar`,
    operationId: "removeMyAvatar",
    summary: "Remove the picture (initials are shown instead)",
    tags: ["Profile"],
    response: MyProfileSchema,
    errors: [401, 403],
  },
  {
    method: "get",
    path: `${ORG}/me/preferences`,
    operationId: "getMyPreferences",
    summary: "Own preferences: appearance, start page, sidebar, date and time, with the device-only defaults",
    tags: ["Preferences"],
    response: PreferencesViewSchema,
    errors: [401, 403],
  },
  {
    method: "patch",
    path: `${ORG}/me/preferences`,
    operationId: "updateMyPreferences",
    summary: "Change own preferences; look fields are ignored (and listed in `ignored`) while the organisation has personalisation off",
    tags: ["Preferences"],
    body: UpdatePreferencesBodySchema,
    response: UpdatePreferencesResponseSchema,
    errors: [400, 401, 403],
  },
  {
    method: "post",
    path: `${ORG}/me/preferences/reset`,
    operationId: "resetMyAppearance",
    summary: "Back to Forest on White; returns a one-time undo token valid for ten minutes",
    tags: ["Preferences"],
    response: ResetPreferencesResponseSchema,
    errors: [401, 403],
  },
  {
    method: "post",
    path: `${ORG}/me/preferences/undo`,
    operationId: "undoMyReset",
    summary: "Restore the look from before the last reset (single use)",
    tags: ["Preferences"],
    body: UndoResetBodySchema,
    response: PreferencesViewSchema,
    errors: [400, 401, 403],
  },
  {
    method: "get",
    path: `${ORG}/look`,
    operationId: "getOrganizationLook",
    summary: "How the organisation looks: name, logo, default theme and page colour (every member can read)",
    tags: ["Organisation"],
    response: OrganizationLookSchema,
    errors: [401, 403],
  },
  {
    method: "patch",
    path: `${ORG}/look`,
    operationId: "updateOrganizationLook",
    summary: "Change the organisation's look and whether members may personalise (Management only)",
    tags: ["Organisation"],
    body: UpdateOrganizationLookBodySchema,
    response: OrganizationLookSchema,
    errors: [400, 401, 403, 404],
  },
  {
    method: "get",
    path: `${ORG}/me/notification-preferences`,
    operationId: "getMyNotificationPreferences",
    summary: "Notification types for the caller's role, channels, presets, quiet hours and daily email limit",
    tags: ["Notifications"],
    response: NotificationPreferencesViewSchema,
    errors: [401, 403],
  },
  {
    method: "patch",
    path: `${ORG}/me/notification-preferences`,
    operationId: "updateMyNotificationPreferences",
    summary: "Change notification preferences; overdue alerts cannot be turned off and push is not available yet",
    tags: ["Notifications"],
    body: UpdateNotificationPreferencesBodySchema,
    response: NotificationPreferencesViewSchema,
    errors: [400, 401, 403],
  },
  ...STAGE2_OPERATIONS,
];

function json(schema: z.ZodType) {
  const out = z.toJSONSchema(schema, {
    io: "output",
    unrepresentable: "any",
    reused: "inline",
  }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

function parametersFor(op: OperationDef) {
  const params: Record<string, unknown>[] = [];
  for (const name of op.path.match(/\{(\w+)\}/g) ?? []) {
    params.push({
      name: name.slice(1, -1),
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }
  if (op.query) {
    for (const [name, field] of Object.entries(op.query.shape)) {
      params.push({
        name,
        in: "query",
        required: !(field as z.ZodType).safeParse(undefined).success,
        schema: json(field as z.ZodType),
      });
    }
  }
  if (op.list) {
    params.push(
      {
        name: "page",
        in: "query",
        schema: { type: "integer", minimum: 1, default: 1 },
      },
      {
        name: "pageSize",
        in: "query",
        description: "Page size, 1 to 100 (default 25). `limit` is an alias.",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
      {
        name: "cursor",
        in: "query",
        description: "`nextCursor` from the previous response; wins over `page`.",
        schema: { type: "string" },
      },
      {
        name: "sort",
        in: "query",
        description: `One of ${op.list.sortFields.join(", ")}; prefix with - for descending.`,
        schema: { type: "string" },
      },
    );
  }
  if (op.idempotent) {
    params.push({
      name: "Idempotency-Key",
      in: "header",
      description:
        "Unique string (8 to 200 printable characters). Retrying the same request with the same key returns the first response instead of creating twice.",
      schema: { type: "string", minLength: 8, maxLength: 200 },
    });
  }
  return params;
}

const ERROR_TEXT: Record<number, string> = {
  400: "Validation failed (`fieldErrors` lists the fields).",
  401: "Not signed in.",
  403: "Not allowed (`denial` explains who can).",
  404: "Not found in this organisation.",
  409: "Idempotency-Key request still in progress.",
  422: "Idempotency-Key already used for a different request.",
  429: "Rate limited.",
  503: "A backing service (for example the malware scanner) is unavailable; retry.",
};

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const responses: Record<string, unknown> = {
      [String(op.successStatus ?? 200)]: {
        description: "Success",
        headers: {
          "x-request-id": { schema: { type: "string" } },
        },
        content: { "application/json": { schema: json(op.response) } },
      },
      500: {
        description: "Unexpected error.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
    };
    for (const status of op.errors) {
      responses[String(status)] = {
        description: op.errorNotes?.[status] ?? ERROR_TEXT[status],
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      };
    }
    (paths[op.path] ??= {})[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      security: [{ sessionCookie: [] }],
      parameters: parametersFor(op),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: json(op.body) } },
            },
          }
        : {}),
      responses,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Figbloom CRM API",
      version: "0.1.0",
      description:
        "Generated from the Zod schemas in src/api/dto. Conventions: docs/API_CONVENTIONS.md.",
    },
    servers: [{ url: "/" }],
    tags: [...new Set(OPERATIONS.flatMap((o) => o.tags))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "figbloom_session" },
      },
      schemas: { ErrorEnvelope: json(ErrorEnvelopeSchema) },
    },
  };
}
