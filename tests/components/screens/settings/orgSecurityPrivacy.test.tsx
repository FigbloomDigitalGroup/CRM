import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LifecycleSettings, OnboardingTemplate } from "../../../../src/ui/screens/settings/Lifecycle";
import { OrganisationProfile } from "../../../../src/ui/screens/settings/OrganisationProfile";
import { DataPrivacy } from "../../../../src/ui/screens/settings/Privacy";
import { RoleMatrix, SecurityAccess } from "../../../../src/ui/screens/settings/Security";
import { buildRoleMatrix } from "../../../../src/ui/screens/settings/matrix";
import { InboundEmail, WebsiteIntegration } from "../../../../src/ui/screens/settings/Website";
import { apiError, page, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

const KEYS = ["configuration.manage", "organization.manage_settings"];

/* Organisation profile and the shared look (S1, AP9) ----------------------------------------------------------------------------- */

const PROFILE = { name: "Figbloom Digital Group", timezone: "Africa/Nairobi", defaultCurrency: "KES", phone: "+254 711 482 900", website: "figbloom.co.ke", address: "Westlands", workingDays: ["MON", "TUE", "WED", "THU", "FRI"], workingHoursStart: "08:00", workingHoursEnd: "17:30" };
const LOOK = { name: "Figbloom Digital Group", shownName: "Figbloom Digital Group", displayName: null, logoUrl: null, defaultTheme: "FOREST", defaultPageColour: "WHITE", colours: {}, showLogoOnClientPages: false, allowPersonalisation: true };

describe("Organization profile and shared look (S1, AP9, FIG-1106)", () => {
  const base = (over: Record<string, Handler> = {}): Record<string, Handler> => ({ getProfile: () => PROFILE, getOrganizationLook: () => LOOK, patchProfile: (a) => ({ ...PROFILE, ...(a.body as object) }), updateOrganizationLook: (a) => ({ ...LOOK, ...(a.body as object) }), ...over });

  it("saves the profile with the working days and hours", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    const { container } = renderScreen(<OrganisationProfile />, client, { permissionKeys: KEYS });
    const name = await screen.findByLabelText(/Organisation name/);
    await user.clear(name);
    await user.type(name, "Figbloom Group");
    await user.click(screen.getByRole("checkbox", { name: "Fri" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchProfile")?.args.body).toMatchObject({ name: "Figbloom Group", timezone: "Africa/Nairobi", workingDays: ["MON", "TUE", "WED", "THU"], workingHoursStart: "08:00", workingHoursEnd: "17:30" }));
    expect(await screen.findByText("Organisation profile saved.")).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("shows the API's field errors next to the field and in a summary", async () => {
    const user = userEvent.setup();
    const { client } = stubClient(base({ patchProfile: () => apiError(400, "Invalid", { code: "VALIDATION_FAILED", fieldErrors: [{ path: "timezone", message: "That is not a time zone." }] }) }));
    renderScreen(<OrganisationProfile />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect((await screen.findAllByText("That is not a time zone.")).length).toBeGreaterThan(0);
  });

  it("locks personalisation, which makes everyone use the shared look", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<OrganisationProfile />, client, { permissionKeys: KEYS });
    const lock = await screen.findByRole("checkbox", { name: /Allow members to personalise their appearance/ });
    expect(lock).toBeChecked();
    expect(screen.getByText(/Text size, density and accessibility always stay personal/)).toBeInTheDocument();
    await user.click(lock);
    await waitFor(() => expect(calls.find((c) => c.id === "updateOrganizationLook")?.args.body).toEqual({ allowPersonalisation: false }));
    expect(await screen.findByText("Everyone now uses the shared look.")).toBeInTheDocument();
  });

  it("sets the default theme for new members", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<OrganisationProfile />, client, { permissionKeys: KEYS });
    await user.selectOptions(await screen.findByLabelText("Default theme for new members"), "Ocean");
    await waitFor(() => expect(calls.find((c) => c.id === "updateOrganizationLook")?.args.body).toEqual({ defaultTheme: "OCEAN" }));
  });

  it("falls back to initials when there is no logo, and checks a logo before uploading it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { client, calls } = stubClient(base());
    renderScreen(<OrganisationProfile />, client, { permissionKeys: KEYS });
    expect(await screen.findByRole("button", { name: "Upload logo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("Logo file"), new File(["x"], "logo.gif", { type: "image/gif" }));
    expect(await screen.findByText("A logo has to be a PNG, JPG or WebP picture.")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("Logo file"), new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" }));
    expect(await screen.findByText(/larger than 2 MB/)).toBeInTheDocument();
    expect(calls.some((c) => c.id === "createFileUpload")).toBe(false);
  });

  it("offers Replace and Remove when a logo exists", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ getOrganizationLook: () => ({ ...LOOK, logoUrl: "/logo.png" }) }));
    renderScreen(<OrganisationProfile />, client, { permissionKeys: KEYS });
    expect(await screen.findByRole("button", { name: "Replace logo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateOrganizationLook")?.args.body).toEqual({ logoFileId: null }));
  });
});

/* Website and inbound email (S1, B4.01) ------------------------------------------------------------------------------------------ */

const KEY = { configured: true, keyPrefix: "fbk_live_7Qm", createdAt: "2026-10-01T10:00:00.000Z", rotatedAt: null, previousKey: null, lastAcceptedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), lastRejectedAt: null, lastRejection: null, revoked: false, allowedOrigins: ["https://figbloom.co.ke"], honeypotFieldName: "website_url", captchaConfigured: false };

describe("Website integration (S1, FIG-1106, B4.01)", () => {
  const base = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
    getIntegrationsWebsiteKey: () => KEY,
    getIntegrationsWebsiteKeyAcknowledgement: () => ({ enabled: true }),
    getIntegrationsWebsiteKeyAssignment: () => ({ mode: "ROUND_ROBIN" }),
    getWebsiteLeadAssignmentRules: () => [{ id: "r-1", name: "CCTV leads", serviceId: "sv-1", leadSourceId: null, assigneeMembershipId: "m-1", assigneeMembershipIds: ["m-1"], sequence: 1, isActive: true }, { id: "r-2", name: "Internet", serviceId: null, leadSourceId: null, assigneeMembershipId: "m-2", assigneeMembershipIds: ["m-2"], sequence: 2, isActive: false }],
    getReferenceData: () => ({ services: [{ id: "sv-1", name: "CCTV" }], leadSources: [], members: [{ membershipId: "m-1", userName: "Dev Sales", roleKey: "SALES", roleName: "Sales" }, { membershipId: "m-2", userName: "Dev Sales Two", roleKey: "SALES", roleName: "Sales" }] }),
    getIntegrationsWebsiteKeyActivity: () => [{ id: "w-1", outcome: "ACCEPTED", reason: null, origin: "https://figbloom.co.ke", ipAddress: "1.2.3.4", createdAt: "2026-10-28T08:00:00.000Z" }, { id: "w-2", outcome: "HONEYPOT_TRIGGERED", reason: "x", origin: null, ipAddress: "5.6.7.8", createdAt: "2026-10-28T07:00:00.000Z" }],
    listRejectedWebsiteSubmissions: () => page([{ id: "w-2", at: "2026-10-28T07:00:00.000Z", outcome: "HONEYPOT_TRIGGERED", reason: "x", explanation: "A hidden field was filled in, which is what a bot does. It was discarded.", origin: null, ipAddress: "5.6.7.8" }]),
    ...over,
  });

  it("shows the key's prefix only, the connection state, rules in order, and the reason a submission was rejected", async () => {
    const { client } = stubClient(base());
    const { container } = renderScreen(<WebsiteIntegration />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/Connected · last lead 5 h ago/)).toBeInTheDocument();
    expect(screen.getByLabelText("API key prefix")).toHaveTextContent("fbk_live_7Qm••••");
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByText("CCTV leads")).toBeInTheDocument();
    expect(screen.getByText(/service is CCTV/)).toBeInTheDocument();
    expect(await screen.findByText(/A hidden field was filled in/)).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText(/never move a deal/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("rotates the key with a grace window and shows the new key once", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ postIntegrationsWebsiteKey: () => ({ apiKey: "fbk_live_NEWSECRET", keyPrefix: "fbk_live_NEW", previousKeyValidUntil: "2026-10-29T10:00:00.000Z" }) }));
    renderScreen(<WebsiteIntegration />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Rotate" }));
    const confirm = await screen.findByRole("dialog", { name: "Rotate the website key?" });
    await user.selectOptions(within(confirm).getByLabelText("Old key keeps working for"), "48 hours");
    await user.click(within(confirm).getByRole("button", { name: "Create new key" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postIntegrationsWebsiteKey")?.args.body).toEqual({ graceHours: 48 }));
    expect(await screen.findByTestId("new-website-key")).toHaveTextContent("fbk_live_NEWSECRET");
  });

  it("revokes only after confirmation", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ postIntegrationsWebsiteKeyRevoke: () => ({}) }));
    renderScreen(<WebsiteIntegration />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(calls.some((c) => c.id === "postIntegrationsWebsiteKeyRevoke")).toBe(false);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postIntegrationsWebsiteKeyRevoke")).toBe(true));
  });

  it("offers to create a key when there is none, and then shows nothing else to configure", async () => {
    const { client } = stubClient(base({ getIntegrationsWebsiteKey: () => ({ configured: false }) }));
    renderScreen(<WebsiteIntegration />, client, { permissionKeys: KEYS });
    expect(await screen.findByRole("button", { name: "Create key" })).toBeInTheDocument();
    expect(screen.queryByText("Abuse protection")).not.toBeInTheDocument();
  });

  it("moves a rule, pauses a rule and saves abuse protection and the acknowledgement", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ postWebsiteLeadAssignmentRulesByRuleIdMove: () => ({ ok: true }), postWebsiteLeadAssignmentRulesByRuleId: () => ({}), postIntegrationsWebsiteKeySettings: () => ({}), postIntegrationsWebsiteKeyAcknowledgement: () => ({ enabled: false }) }));
    renderScreen(<WebsiteIntegration />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Move Internet up" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postWebsiteLeadAssignmentRulesByRuleIdMove")?.args).toMatchObject({ params: { ruleId: "r-2" }, body: { direction: "up" } }));
    expect(screen.getByRole("button", { name: "Move CCTV leads up" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("switch", { name: "CCTV leads is on" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postWebsiteLeadAssignmentRulesByRuleId")?.args.body).toEqual({ isActive: false }));
    await user.type(screen.getByLabelText(/Challenge secret/), "s3cret");
    await user.click(screen.getByRole("button", { name: "Save protection" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postIntegrationsWebsiteKeySettings")?.args.body).toEqual({ allowedOrigins: ["https://figbloom.co.ke"], honeypotFieldName: "website_url", captchaSecret: "s3cret" }));
    await user.click(screen.getByRole("switch", { name: "Email the enquirer automatically" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postIntegrationsWebsiteKeyAcknowledgement")?.args.body).toEqual({ enabled: false }));
  });
});

describe("Inbound email (S1, FIG-1106)", () => {
  it("shows when mail last arrived and the last problem, never the key itself", async () => {
    const { client } = stubClient({ getIntegrationsInboundEmailKey: () => ({ configured: true, keyPrefix: "fbi_abc", lastReceivedAt: "2026-10-28T07:12:00.000Z", lastError: { at: "2026-10-28T07:00:00.000Z", message: "Sender was not recognised." }, revoked: false }) });
    renderScreen(<InboundEmail />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/Key fbi_abc••••/)).toBeInTheDocument();
    expect(screen.getByText(/Sender was not recognised/)).toBeInTheDocument();
  });

  it("regenerates after confirmation and shows the new key once", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient({ getIntegrationsInboundEmailKey: () => ({ configured: true, keyPrefix: "fbi_abc", lastReceivedAt: null, lastError: null, revoked: false }), postIntegrationsInboundEmailKey: () => ({ token: "fbi_NEWTOKEN", keyPrefix: "fbi_NEW" }) });
    renderScreen(<InboundEmail />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Regenerate key" }));
    expect(calls.some((c) => c.id === "postIntegrationsInboundEmailKey")).toBe(false);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Regenerate" }));
    expect(await screen.findByTestId("new-inbound-key")).toHaveTextContent("fbi_NEWTOKEN");
  });
});

/* Lifecycle and onboarding template (S1) -------------------------------------------------------------------------------------- */

describe("Customer lifecycle and onboarding template (S1, FIG-1106)", () => {
  it("saves renewal timing and switches a reminder, saying reminders never move a customer", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient({ getRenewalSettings: () => ({ dueSoonDays: 30, graceDays: 14 }), getReminderSettings: () => ({ proposalFollowUp: { enabled: true, days: 5 }, renewal: { enabled: true, daysAhead: 30 }, dormant: { enabled: false }, overdueInvoices: { enabled: true } }), updateRenewalSettings: () => ({}), updateReminderSettings: () => ({}) });
    renderScreen(<LifecycleSettings />, client, { permissionKeys: KEYS });
    const due = await screen.findByLabelText("Due soon (days before renewal)");
    await user.clear(due);
    await user.type(due, "45");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateRenewalSettings")?.args.body).toEqual({ dueSoonDays: 45, graceDays: 14 }));
    expect(screen.getByText(/never move a customer between lifecycle states/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Spot customers going quiet" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateReminderSettings")?.args.body).toEqual({ dormant: { enabled: true } }));
  });

  it("edits the onboarding tasks offered at handoff and will not save an untitled task", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient({ getHandoffSettings: () => ({ tasks: [{ title: "Kick-off call", dueInDays: 1, priority: "HIGH" }], customerLifecycleStateId: null, managementCanMarkDelivered: true }), getReferenceData: () => ({ lifecycleStates: [{ id: "ls-1", name: "Onboarding", isActive: true }] }), putHandoffSettings: () => ({}) });
    renderScreen(<OnboardingTemplate />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Add a task" }));
    expect(screen.getByRole("button", { name: "Save template" })).toHaveAttribute("aria-disabled", "true");
    await user.type(screen.getByLabelText("Task 2"), "Send welcome pack");
    await user.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(calls.find((c) => c.id === "putHandoffSettings")?.args.body).toMatchObject({ tasks: [{ title: "Kick-off call", dueInDays: 1, priority: "HIGH" }, { title: "Send welcome pack", dueInDays: 1, priority: "MEDIUM" }], customerLifecycleStateId: null, managementCanMarkDelivered: true }));
  });
});

/* Security and access (S8) ------------------------------------------------------------------------------------------------------ */

describe("Security and access (S8, FIG-1111)", () => {
  const base = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
    getSecuritySessionPolicy: () => ({ lifetimeHours: 12, options: [4, 8, 12, 24], defaultHours: 12, maxAbsoluteHours: 24, warnSecondsBeforeExpiry: 300 }),
    getSecuritySignInEvents: () => page([{ id: "e-1", userName: "Dev Sales", email: "s@x", outcome: "SUCCESS", reason: null, deviceLabel: "Chrome on Windows", ipAddress: "1.1.1.1", place: "Nairobi", createdAt: "2026-10-28T08:00:00.000Z" }, { id: "e-2", userName: null, email: "who@x", outcome: "FAILURE", reason: "wrong password", deviceLabel: "Android", ipAddress: "2.2.2.2", place: "Lagos", createdAt: "2026-10-28T07:00:00.000Z" }]),
    patchSecuritySessionPolicy: () => ({}),
    ...over,
  });

  it("changes the session lifetime (only when it is different) and says it applies to new sessions", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    const { container } = renderScreen(<SecurityAccess matrix={null} />, client, { permissionKeys: KEYS });
    const save = await screen.findByRole("button", { name: "Save policy" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Applies to new sessions/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Sign people out after"), "8 hours");
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchSecuritySessionPolicy")?.args.body).toEqual({ lifetimeHours: 8 }));
    expect(await screen.findByText("Session policy saved. It applies to new sessions.")).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("states the lockout rule as a fact, lists sign-in events with failures marked, and filters them", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<SecurityAccess matrix={null} />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/locked for 15 minutes after 5 wrong passwords/)).toBeInTheDocument();
    expect(await screen.findByText("Dev Sales")).toBeInTheDocument();
    expect(screen.getByText(/Wrong password or unknown account/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Show"), "Failed");
    await waitFor(() => expect(calls.filter((c) => c.id === "getSecuritySignInEvents").at(-1)?.args.query).toMatchObject({ outcome: "FAILURE", page: "1" }));
    expect(screen.getByText("Remove from organisation")).toBeInTheDocument();
    expect(screen.getByText("Restricted Technical")).toBeInTheDocument();
  });

  it("shows a refusal as the explained no-access card", async () => {
    const { client } = stubClient(base({ getSecuritySessionPolicy: () => apiError(403, "No") }));
    renderScreen(<SecurityAccess matrix={null} />, client, { permissionKeys: [] });
    expect(await screen.findByRole("region", { name: /isn’t part of your workspace/ })).toBeInTheDocument();
  });

  it("renders the role matrix read-only, with a column per role and nothing to edit", async () => {
    const matrix = buildRoleMatrix();
    const { client } = stubClient({});
    const { container } = renderScreen(<RoleMatrix matrix={matrix} />, client, {});
    const table = screen.getByRole("table", { name: "Role matrix" });
    for (const r of matrix.roles) expect(within(table).getByRole("columnheader", { name: r.name })).toBeInTheDocument();
    expect(within(table).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(table).queryAllByRole("button")).toHaveLength(0);
    const row = within(table).getByText("audit.view").closest("tr")!;
    expect(within(row).getAllByLabelText(/ can$/)).toHaveLength(1);
    expect(within(row).getByLabelText("Management can")).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });
});

/* Data and privacy (S9) -------------------------------------------------------------------------------------------------------- */

const OVERVIEW = {
  exportRights: { allowedRoleKeys: ["MANAGEMENT", "SALES"], approvalThreshold: 500, approvalExpiryHours: 24, thresholdRange: { min: 50, max: 10000 }, expiryRange: { min: 1, max: 168 } },
  retention: [{ key: "signInEvents", label: "Sign-in history", description: "Who signed in.", unit: "months", value: 24, default: 24, min: 3, max: 120, isDefault: true }, { key: "archivedLeads", label: "Archived leads", description: "Kept until you set a period.", unit: "months", value: null, default: null, min: 12, max: 240, isDefault: true }],
  legalHold: { active: false, reason: null, since: null },
  requests: { open: 1, overdue: 1, dueDays: 30 },
  pendingExportApprovals: 2,
};
const DSR = { id: "q-1", kind: "ERASURE", status: "OPEN", subject: { contactId: "c-1", label: "Amara Osei" }, dueOn: "2026-10-20T00:00:00.000Z", overdue: true, daysLeft: null, hasExport: false, confirmations: { first: null, second: null } };

describe("Data and privacy (S9, FIG-1111)", () => {
  const base = (over: Record<string, Handler> = {}): Record<string, Handler> => ({ getPrivacyOverview: () => OVERVIEW, listDataSubjectRequests: () => page([DSR, { ...DSR, id: "q-2", kind: "ACCESS", subject: { contactId: "c-2", label: "Kofi Mensah" }, overdue: false, daysLeft: 12, dueOn: "2026-11-09T00:00:00.000Z" }]), updateExportRights: () => ({}), updateRetention: () => ({}), setLegalHold: () => ({}), ...over });

  it("explains the export log, flags pending approvals, and lists requests with deadlines and overdue marked", async () => {
    const { client } = stubClient(base());
    const { container } = renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/Every export is written to the audit log/)).toBeInTheDocument();
    expect(screen.getByText(/2 exports are waiting for approval/)).toBeInTheDocument();
    const overdue = await screen.findByText(/Amara Osei · Deletion/);
    expect(overdue.closest(".fb-set-row")).toHaveTextContent("Overdue");
    expect(screen.getByText(/Kofi Mensah · Access/).closest(".fb-set-row")).toHaveTextContent("12 days left");
    expect(await violations(container)).toEqual([]);
  });

  it("saves export rights; Management can never be unticked", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    expect(await screen.findByRole("checkbox", { name: "Management" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Finance" }));
    await user.click(screen.getByRole("button", { name: "Save export rights" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateExportRights")?.args.body).toEqual({ allowedRoleKeys: ["MANAGEMENT", "SALES", "FINANCE"], approvalThreshold: 500, approvalExpiryHours: 24 }));
  });

  it("saves retention, keeping an empty period as 'keep'", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    const signIn = await screen.findByLabelText("Sign-in history (months)");
    await user.clear(signIn);
    await user.type(signIn, "36");
    await user.type(screen.getByLabelText("Archived leads (months)"), "18");
    await user.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateRetention")?.args.body).toEqual({ signInEvents: 36, archivedLeads: 18 }));
  });

  it("needs a reason for a legal hold, and lifting one is one click", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    const hold = await screen.findByRole("button", { name: "Place a legal hold" });
    expect(hold).toHaveAttribute("aria-disabled", "true");
    await user.type(screen.getByLabelText("Reason"), "Dispute with a customer");
    await user.click(screen.getByRole("button", { name: "Place a legal hold" }));
    await waitFor(() => expect(calls.find((c) => c.id === "setLegalHold")?.args.body).toEqual({ active: true, reason: "Dispute with a customer" }));
  });

  it("shows an active hold and lifts it", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ getPrivacyOverview: () => ({ ...OVERVIEW, legalHold: { active: true, reason: "Dispute", since: "2026-10-20T00:00:00.000Z" } }) }));
    renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/On since .*Dispute/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lift the hold" }));
    await waitFor(() => expect(calls.find((c) => c.id === "setLegalHold")?.args.body).toEqual({ active: false }));
  });

  it("logs a request for a found person, and records a confirmation for a deletion", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ getContacts: () => page([{ id: "c-9", firstName: "Zuri", lastName: "Kamau", email: "z@k.co" }]), createDataSubjectRequest: () => ({}), confirmErasure: () => ({}) }));
    renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Log a request" }));
    const dialog = await screen.findByRole("dialog", { name: "Log a data request" });
    expect(within(dialog).getByRole("button", { name: "Log request" })).toHaveAttribute("aria-disabled", "true");
    await user.type(within(dialog).getByLabelText("Find the person"), "Zuri");
    await user.click(await within(dialog).findByRole("button", { name: /Zuri Kamau/ }));
    await user.click(within(dialog).getByRole("button", { name: "Log request" }));
    await waitFor(() => expect(calls.find((c) => c.id === "createDataSubjectRequest")?.args.body).toEqual({ kind: "ACCESS", contactId: "c-9" }));

    await user.click(await screen.findByRole("button", { name: "Confirm deletion" }));
    const confirm = await screen.findByRole("dialog", { name: "Confirm this deletion?" });
    expect(confirm).toHaveTextContent(/two different people/);
    await user.click(within(confirm).getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(calls.find((c) => c.id === "confirmErasure")?.args.params).toMatchObject({ requestId: "q-1" }));
  });

  it("will not decline a request without a reason", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base({ rejectDataSubjectRequest: () => ({}) }));
    renderScreen(<DataPrivacy />, client, { permissionKeys: KEYS });
    const row = (await screen.findByText(/Kofi Mensah · Access/)).closest(".fb-set-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline this request" });
    expect(within(dialog).getByRole("button", { name: "Decline" })).toHaveAttribute("aria-disabled", "true");
    await user.type(within(dialog).getByLabelText("Reason"), "We hold nothing about this person.");
    await user.click(within(dialog).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(calls.find((c) => c.id === "rejectDataSubjectRequest")?.args.body).toEqual({ reason: "We hold nothing about this person." }));
  });
});

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
