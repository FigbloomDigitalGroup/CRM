import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_PERMISSIONS } from "../../../prisma/seedData";
import { MemberProvider, testMember, ToastProvider, type Member } from "../../../src/ui";
import { ChatWorkspace } from "../../../src/ui/screens/communication/ChatWorkspace";
import { MailWorkspace } from "../../../src/ui/screens/communication/MailWorkspace";
import { VideoConference } from "../../../src/ui/screens/communication/VideoConference";
import { resetCommunicationDemo } from "../../../src/ui/screens/communication/demo/store";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/chat", useRouter: () => ({ push: vi.fn() }) }));

function as(role: keyof typeof ROLE_PERMISSIONS, ui: ReactElement, extra: Partial<Member> = {}) {
  const member = testMember({ userName: `Dev ${role}`, roleName: role, permissionKeys: ROLE_PERMISSIONS[role]!, ...extra });
  return render(
    <MemberProvider value={member}>
      <ToastProvider>{ui}</ToastProvider>
    </MemberProvider>,
  );
}

function connect(kind: "email" | "calendar") {
  localStorage.setItem("figbloom-demo-connections:figbloom", JSON.stringify({ email: kind === "email" ? 4 : 0, calendar: kind === "calendar" ? 4 : 0 }));
}

beforeEach(() => {
  resetCommunicationDemo();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Chat (F6.21)", () => {
  it("posts a message and mentions a colleague", async () => {
    as("SALES", <ChatWorkspace />);
    const box = screen.getByRole("textbox", { name: "Message #general" });
    await userEvent.type(box, "Hello team @Amina Wekesa");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const log = screen.getByRole("log", { name: "Messages" });
    expect(await within(log).findByText("@Amina Wekesa")).toBeInTheDocument();
    expect(within(log).getByText(/Hello team/)).toBeInTheDocument();
  });

  it("a record card in a deal channel never shows a payment to Sales, and shows it to Finance", async () => {
    const { unmount } = as("SALES", <ChatWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: /Kisumu Greens website/ }));
    const log = screen.getByRole("log", { name: "Messages" });
    expect(within(log).getByText("Payment due")).toBeInTheDocument();
    expect(within(log).queryByText(/120,000/)).not.toBeInTheDocument();
    unmount();

    as("FINANCE", <ChatWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: /Kisumu Greens website/ }));
    expect(within(screen.getByRole("log", { name: "Messages" })).getByText(/120,000/)).toBeInTheDocument();
  });

  it("Restricted Technical sees only the channels it was added to", () => {
    as("RESTRICTED_TECHNICAL", <ChatWorkspace />);
    const side = screen.getByRole("complementary", { name: /Channels and direct messages/ });
    expect(within(side).getByRole("button", { name: /general/ })).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: /field-ops/ })).toBeInTheDocument();
    for (const hidden of [/sales-team/, /finance-desk/, /leadership/, /Kisumu Greens/]) expect(within(side).queryByRole("button", { name: hidden })).not.toBeInTheDocument();
  });

  it("private channels follow the permission that guards them", () => {
    const { unmount } = as("SALES", <ChatWorkspace />);
    expect(screen.queryByRole("button", { name: /leadership/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finance-desk/ })).not.toBeInTheDocument();
    unmount();
    as("MANAGEMENT", <ChatWorkspace />);
    expect(screen.getByRole("button", { name: /leadership/ })).toBeInTheDocument();
  });

  it("marks a conversation read when it is opened", async () => {
    as("MANAGEMENT", <ChatWorkspace />);
    const row = () => screen.getByRole("button", { name: /field-ops/ });
    expect(within(row()).getByLabelText("2 unread")).toBeInTheDocument();
    await userEvent.click(row());
    await waitFor(() => expect(within(row()).queryByLabelText(/unread/)).not.toBeInTheDocument());
  });

  it("creates a channel, refusing a name that already exists", async () => {
    as("MANAGEMENT", <ChatWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: "New channel" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Channel name/), "general");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create channel" }));
    expect(within(dialog).getByText(/already exists/)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText(/Channel name/));
    await userEvent.type(within(dialog).getByLabelText(/Channel name/), "site-visits");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create channel" }));
    expect(await screen.findByRole("button", { name: /site-visits/ })).toBeInTheDocument();
  });
});

describe("Mail (F6.22)", () => {
  it("explains no-access to a role that may not send mail", () => {
    as("FINANCE", <MailWorkspace />);
    expect(screen.getByRole("heading", { name: "Mail", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Compose/ })).not.toBeInTheDocument();
  });

  it("hides mail linked to a colleague's lead from a person who cannot see all leads, and says so", () => {
    as("SALES", <MailWorkspace />);
    expect(screen.queryByText("Warehouse tracker pricing")).not.toBeInTheDocument();
    expect(screen.getByText(/hidden because it is linked to a colleague/)).toBeInTheDocument();
  });

  it("cannot compose until the mailbox is connected, then sends and logs on the record", async () => {
    as("MANAGEMENT", <MailWorkspace />);
    expect(await screen.findByText(/Your mailbox is not connected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect mailbox" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Connect" }));
    await userEvent.click(await screen.findByRole("button", { name: /Compose/ }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Send/ }));
    expect(within(dialog).getByText(/full email address/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^To/), "esther@savannafoods.example");
    await userEvent.type(within(dialog).getByLabelText(/Subject/), "Quote follow-up");
    await userEvent.type(within(dialog).getByLabelText(/Message/), "Thanks");
    await userEvent.selectOptions(within(dialog).getByLabelText(/Record/), "deal:savanna");
    await userEvent.click(within(dialog).getByRole("button", { name: /Send/ }));
    expect(await screen.findByText(/Sent and logged on Deal: Savanna Foods cold-room monitoring and in Conversations/)).toBeInTheDocument();
  });

  it("an unlinked message waits in Needs linking and leaves once it is linked", async () => {
    connect("email");
    as("MANAGEMENT", <MailWorkspace />);
    await userEvent.click(screen.getByRole("tab", { name: /Needs linking/ }));
    await userEvent.click(screen.getByRole("button", { name: /Do you do POS for dairies/ }));
    await userEvent.selectOptions(screen.getByLabelText("Link to a record"), "lead:nakuru");
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByText(/Nothing needs linking/)).toBeInTheDocument();
  });

  it("an automation's draft is marked and is only sent by a person", async () => {
    connect("email");
    as("MANAGEMENT", <MailWorkspace />);
    await userEvent.click(screen.getByRole("tab", { name: /Drafts/ }));
    await userEvent.click(screen.getByRole("button", { name: /Follow-up after the call/ }));
    expect(screen.getByText(/Drafted by an automation/)).toBeInTheDocument();
    expect(screen.getByText(/not sent until you review it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await userEvent.click(screen.getByRole("tab", { name: /Sent/ }));
    expect(screen.getByRole("button", { name: /Follow-up after the call/ })).toBeInTheDocument();
  });
});

describe("Video Conference (F6.23)", () => {
  it("explains no-access to a role with no calendar", () => {
    as("FINANCE", <VideoConference />);
    expect(screen.queryByRole("button", { name: /Schedule/ })).not.toBeInTheDocument();
  });

  it("schedules with validation and flags a contact with no email before invites go out", async () => {
    connect("calendar");
    as("SALES", <VideoConference />);
    await userEvent.click(await screen.findByRole("button", { name: /Schedule/ }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Schedule and send invites/ }));
    expect(within(dialog).getByText("Give the meeting a title.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose at least one attendee.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Title/), "Kisumu review");
    await userEvent.click(within(dialog).getByLabelText(/Lucy Chebet/));
    expect(within(dialog).getByText(/will not get an invite/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText(/Amina Wekesa/));
    await userEvent.click(within(dialog).getByRole("button", { name: /Schedule and send invites/ }));
    expect(await screen.findByText(/1 invite sent, 1 not sent \(no email\)/)).toBeInTheDocument();
    expect(screen.getByText("Kisumu review")).toBeInTheDocument();
  });

  it("is blocked, with a reason, while the calendar is not connected", async () => {
    as("SALES", <VideoConference />);
    expect(await screen.findByText(/Your calendar is not connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("cancels a meeting after a confirmation", async () => {
    connect("calendar");
    as("SALES", <VideoConference />);
    const row = (await screen.findByText("Booking system demo")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel meeting" }));
    await userEvent.click(screen.getByRole("tab", { name: /Past and cancelled/ }));
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});
