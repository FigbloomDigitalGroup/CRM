import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArchivedBanner, EmptyState, ErrorState, LoadingState, MaskedValue, NoAccess, OfflineBanner, describeError, copy } from "../../../src/ui";

/** F1.05: the seven states, in the design's words, and the rule that a person never sees a raw error. */

describe("describeError", () => {
  const api = (status: number, envelope: Record<string, unknown> = {}) => ({ status, envelope: { requestId: "req_1", ...envelope } });

  it("maps every kind of failure to the copy deck", () => {
    expect(describeError(api(401)).kind).toBe("signedOut");
    expect(describeError(api(403, { denial: { yourRole: "Finance", ownerRoles: ["Sales"], whoToAsk: ["Dev Management"] } })).kind).toBe("noAccess");
    expect(describeError(api(404)).kind).toBe("notFound");
    expect(describeError(api(409, { message: "That lead was changed by someone else." })).kind).toBe("conflict");
    expect(describeError(api(429)).kind).toBe("rateLimited");
    expect(describeError(api(400, { message: "Check the email.", fieldErrors: [{ path: "email", message: "Bad" }] })).kind).toBe("validation");
    expect(describeError(api(500)).kind).toBe("server");
    expect(describeError(api(502)).retryable).toBe(true);
    expect(describeError(new TypeError("Failed to fetch")).kind).toBe("offline");
  });

  it("never passes a server error's message through; only validation and conflict messages, which the API writes for people", () => {
    const secret = "PrismaClientKnownRequestError: connection string postgres://user:pass@db failed at line 42";
    for (const status of [500, 502, 503]) {
      const d = describeError(api(status, { message: secret }));
      expect(`${d.title} ${d.body}`).not.toMatch(/Prisma|postgres|pass|line 42/);
    }
    expect(describeError(api(404, { message: secret })).body).not.toContain("Prisma");
    expect(describeError(api(401, { message: secret })).body).not.toContain("Prisma");
    expect(describeError(api(400, { message: "Check the email." })).body).toBe("Check the email.");
    expect(describeError(new Error("secret stack trace")).body).toBe(copy.error.body);
  });

  it("keeps the request id as the reference support needs", () => {
    expect(describeError(api(500)).reference).toBe("req_1");
    expect(describeError(new Error("x")).reference).toBeNull();
  });
});

describe("the seven states", () => {
  it("loading is announced and has an accessible label", () => {
    render(<LoadingState label="Loading leads" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading leads");
  });

  it("empty says what is missing and offers the next action", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<EmptyState title="No leads yet" body="Add your first lead or import a spreadsheet." action={<button onClick={onAdd}>Add a lead</button>} />);
    expect(screen.getByRole("heading", { name: "No leads yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a lead" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("an error offers retry and the reference, and shows nothing technical", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState error={{ status: 500, envelope: { requestId: "req_8f2a91", message: "ECONNREFUSED 10.0.0.4:5432" } }} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("req_8f2a91");
    expect(screen.queryByText(/ECONNREFUSED|5432/)).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.error.retry }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("an error that was a refusal becomes the explained no-access state, and a 401 offers sign-in", () => {
    const { unmount } = render(<ErrorState area="Payments" error={{ status: 403, envelope: { denial: { yourRole: "Sales", ownerRoles: ["Finance", "Management"], whoToAsk: ["Dev Management"] } } }} />);
    expect(screen.getByText("Payments isn’t part of your workspace.")).toBeInTheDocument();
    unmount();
    render(<ErrorState error={{ status: 401 }} />);
    expect(screen.getByRole("link", { name: copy.error.signedOut.action })).toHaveAttribute("href", "/login");
  });

  it("no access names the role, who has access and who to ask", () => {
    render(<NoAccess area="Leads" denial={{ yourRole: "Finance", ownerRoles: ["Management", "Sales"], whoToAsk: ["Dev Management"] }} />);
    expect(screen.getByRole("region", { name: "Leads isn’t part of your workspace." })).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Management, Sales")).toBeInTheDocument();
    expect(screen.getByText("Dev Management")).toBeInTheDocument();
  });

  it("no access still tells the person who to ask when the server could not name anyone", () => {
    render(<NoAccess area="Reports" denial={null} />);
    expect(screen.getByText(copy.noAccess.fallbackAsk)).toBeInTheDocument();
  });

  it("a masked value never puts the value in the page, and explains the gap to assistive technology", () => {
    const { container } = render(<p>Deal value: <MaskedValue reason="Deal values are visible to Management and Sales only." /></p>);
    expect(container.textContent).not.toMatch(/\d{3}/);
    const note = screen.getByRole("note");
    expect(note).toHaveAccessibleName("Hidden. Deal values are visible to Management and Sales only.");
    expect(note).toHaveAttribute("tabindex", "0");
  });

  it("an archived record says it is read-only and, when restoring is not allowed, why", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const { rerender } = render(<ArchivedBanner what="lead" onRestore={onRestore} />);
    await user.click(screen.getByRole("button", { name: copy.archived.restore }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    rerender(<ArchivedBanner what="lead" onRestore={onRestore} restoreDisabledReason="Only Management can restore." />);
    await user.click(screen.getByRole("button", { name: copy.archived.restore }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Only Management can restore\./, { selector: ".fb-banner__body" })).toBeInTheDocument();
  });

  it("offline says saves are queued and how many", () => {
    render(<OfflineBanner queued={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline. Saves are queued.");
    expect(screen.getByRole("status")).toHaveTextContent("2 changes waiting to be sent.");
  });
});
