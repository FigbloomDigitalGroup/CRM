import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Members } from "../../../../src/ui/screens/settings/Members";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

const KEYS = ["membership.view", "membership.manage", "role.assign", "configuration.manage"];

function m(over: Record<string, unknown> = {}) {
  return {
    membershipId: "m-x",
    userId: "u-x",
    userName: "Someone",
    userEmail: "someone@figbloom.local",
    roleKey: "SALES",
    roleName: "Sales",
    status: "ACTIVE",
    state: "active",
    invitedAt: null,
    joinedAt: "2026-10-01T10:00:00.000Z",
    inviteExpiresAt: null,
    inviteExpired: false,
    inviteLastSentAt: null,
    deactivatedAt: null,
    removedAt: null,
    lastSignInAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    lockedUntil: null,
    avatarUrl: null,
    initials: "SO",
    ...over,
  };
}

const ROWS = [
  m({ membershipId: "m-1", userName: "Dev Management", userEmail: "mgmt@x", roleKey: "MANAGEMENT", roleName: "Management" }),
  m({ membershipId: "m-2", userName: "Dev Sales", userEmail: "sales@x" }),
  m({ membershipId: "m-3", userName: "New Hire", userEmail: "hire@x", state: "invited", status: "PENDING", lastSignInAt: null, inviteLastSentAt: "2026-10-27T08:00:00.000Z" }),
  m({ membershipId: "m-4", userName: "Gone Gary", userEmail: "gary@x", state: "deactivated", status: "INACTIVE", deactivatedAt: "2026-10-20T08:00:00.000Z" }),
  m({ membershipId: "m-5", userName: "Removed Rita", userEmail: "rita@x", state: "removed", status: "REMOVED", removedAt: "2026-10-10T08:00:00.000Z" }),
  m({ membershipId: "m-6", userName: "Locked Lee", userEmail: "lee@x", lockedUntil: new Date(Date.now() + 600_000).toISOString() }),
];

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return { getMemberships: () => ROWS, ...over };
}
const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

describe("Members (S1, FIG-1106, B1.12 and B4.01)", () => {
  it("shows the four states, and only offers what each state allows", async () => {
    const { client } = stubClient(handlers());
    const { container } = renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await screen.findByText("Dev Sales");
    expect(within(rowOf("Dev Sales")).getByText("Active")).toBeInTheDocument();
    expect(within(rowOf("New Hire")).getByText("Invited")).toBeInTheDocument();
    expect(within(rowOf("Gone Gary")).getByText("Deactivated")).toBeInTheDocument();
    expect(within(rowOf("Removed Rita")).getByText("Removed")).toBeInTheDocument();
    expect(within(rowOf("Locked Lee")).getByText("Locked")).toBeInTheDocument();

    expect(within(rowOf("Dev Sales")).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(within(rowOf("New Hire")).getByRole("button", { name: "Resend invite" })).toBeInTheDocument();
    expect(within(rowOf("New Hire")).getByRole("button", { name: "Cancel invite" })).toBeInTheDocument();
    expect(within(rowOf("Gone Gary")).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(within(rowOf("Locked Lee")).getByRole("button", { name: "Unlock" })).toBeInTheDocument();
    // A removed member has no actions; you cannot act on yourself, and your own role is not editable.
    expect(within(rowOf("Removed Rita")).queryAllByRole("button")).toHaveLength(0);
    expect(within(rowOf("Dev Management")).queryAllByRole("button")).toHaveLength(0);
    expect(within(rowOf("Dev Management")).getByRole("combobox", { name: /Role for Dev Management/ })).toBeDisabled();
    expect(await violations(container)).toEqual([]);
  });

  it("invites with name, email and role, and says so", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers({ postMemberships: () => ({ ok: true }) }));
    renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await screen.findByText("Dev Sales");
    const form = screen.getByRole("form", { name: "Invite a member" });
    await user.type(within(form).getByLabelText(/Name/), "Pat Invitee");
    await user.type(within(form).getByLabelText(/Email/), "pat@example.com");
    await user.selectOptions(within(form).getByLabelText("Role"), "Delivery");
    await user.click(within(form).getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postMemberships")).toBe(true));
    expect(calls.find((c) => c.id === "postMemberships")!.args.body).toEqual({ name: "Pat Invitee", email: "pat@example.com", roleKey: "DELIVERY" });
    expect((await screen.findAllByText("Invite sent to pat@example.com.")).length).toBeGreaterThan(0);
  });

  it("changes a role through the API", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers({ postMembershipsByMembershipIdRole: () => ({}) }));
    renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Role for Dev Sales" }), "DELIVERY");
    await waitFor(() => expect(calls.find((c) => c.id === "postMembershipsByMembershipIdRole")?.args.body).toEqual({ roleKey: "DELIVERY" }));
  });

  it("asks before deactivating, and keeps the person's records", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers({ postMembershipsByMembershipIdDeactivate: () => ({ reassignment: { membershipId: "m-2", userName: "Dev Sales", total: 3, totals: { tasks: 2, leads: 1, deals: 0 } } }) }));
    renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await user.click(within(await screen.findByRole("row", { name: /Dev Sales/ })).getByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog", { name: /Deactivate Dev Sales/ });
    expect(dialog).toHaveTextContent(/keep their history/);
    expect(calls.some((c) => c.id === "postMembershipsByMembershipIdDeactivate")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    // Open work is listed afterwards so it can be handed over.
    expect(await screen.findByRole("dialog", { name: /Dev Sales still owns 3 open records/ })).toBeInTheDocument();
  });

  it("refuses to remove someone who owns open records, lists them, and hands them over first", async () => {
    const user = userEvent.setup();
    let removed = 0;
    const { client, calls } = stubClient(handlers({
      postMembershipsByMembershipIdRemove: () => {
        removed += 1;
        if (removed === 1) return apiError(409, "Hand over first", { code: "REASSIGNMENT_REQUIRED" });
        return {};
      },
      getMembershipsByMembershipIdReassignment: () => ({ membershipId: "m-2", userName: "Dev Sales", total: 4, totals: { tasks: 3, leads: 1 } }),
      postMembershipsByMembershipIdReassign: () => ({}),
    }));
    renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await user.click(within(await screen.findByRole("row", { name: /Dev Sales/ })).getByRole("button", { name: "Remove" }));
    await user.click(within(await screen.findByRole("dialog", { name: /Remove Dev Sales/ })).getByRole("button", { name: "Remove" }));
    const hand = await screen.findByRole("dialog", { name: /Hand over Dev Sales’s open records/ });
    expect(hand).toHaveTextContent("3 tasks");
    expect(hand).toHaveTextContent("1 leads");
    await user.selectOptions(within(hand).getByLabelText("Hand over to"), "Dev Management (Management)");
    await user.click(within(hand).getByRole("button", { name: "Hand over 4" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postMembershipsByMembershipIdReassign")?.args.body).toEqual({ toMembershipId: "m-1" }));
  });

  it("cancelling an invite is worded as cancelling, not removing", async () => {
    const user = userEvent.setup();
    const { client } = stubClient(handlers());
    renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await user.click(within(await screen.findByRole("row", { name: /New Hire/ })).getByRole("button", { name: "Cancel invite" }));
    expect(await screen.findByRole("dialog", { name: "Cancel this invite?" })).toHaveTextContent(/invite link stops working/);
  });

  it("explains a refusal instead of failing silently", async () => {
    const user = userEvent.setup();
    const { client } = stubClient(handlers({ postMembershipsByMembershipIdReactivate: () => apiError(409, "The Sales role is not switched on for this organisation yet.") }));
    renderScreen(<Members />, client, { permissionKeys: KEYS, membershipId: "m-1" });
    await user.click(within(await screen.findByRole("row", { name: /Gone Gary/ })).getByRole("button", { name: "Reactivate" }));
    expect(await screen.findByText(/not switched on for this organisation yet/)).toBeInTheDocument();
  });
});
