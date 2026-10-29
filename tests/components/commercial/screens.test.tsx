import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Approvals } from "../../../src/ui/screens/commercial/Approvals";
import { Forecast } from "../../../src/ui/screens/commercial/Forecast";
import { QuoteBuilder } from "../../../src/ui/screens/commercial/QuoteBuilder";
import { DELIVERY, MANAGEMENT, renderAs, SALES } from "./helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/quotes", useRouter: () => ({ push: vi.fn() }) }));

describe("quote builder (Q1, FIG-1168)", () => {
  it("shows margin (the column and the summary row) only to a role with deals.margin", () => {
    const { unmount } = renderAs(<QuoteBuilder dealId="d1" />, MANAGEMENT);
    expect(screen.getByRole("columnheader", { name: "Margin" })).toBeInTheDocument();
    expect(screen.getByText(/Margin \(Management only\)/)).toBeInTheDocument();
    unmount();

    renderAs(<QuoteBuilder dealId="d1" />, SALES);
    expect(screen.queryByRole("columnheader", { name: "Margin" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Margin/)).not.toBeInTheDocument();
  });

  it("the client document never carries cost or margin, even for Management", async () => {
    renderAs(<QuoteBuilder dealId="d1" />, MANAGEMENT);
    await userEvent.click(screen.getByRole("button", { name: /Preview document/ }));
    const doc = screen.getByRole("region", { name: /document preview/ });
    expect(within(doc).queryByText(/margin|cost/i)).not.toBeInTheDocument();
    expect(within(doc).getByText("Total (incl. VAT)")).toBeInTheDocument();
  });

  it("a sent version is read-only, and New version starts a draft while the history keeps the sent one", async () => {
    renderAs(<QuoteBuilder dealId="d1" />, SALES);
    expect(screen.getByLabelText(/Quantity for CCTV camera/)).toHaveAttribute("readonly");
    expect(screen.getByText(/cannot be changed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /New version/ }));
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity for CCTV camera/)).not.toHaveAttribute("readonly");
    expect(screen.getByText("New version from v1")).toBeInTheDocument();
    expect(screen.getByText(/Sent to Amara Osei with a signing link/)).toBeInTheDocument();
  });

  it("a discount above the limit goes to Management instead of being sent, and the request lands in the approvals inbox", async () => {
    renderAs(<QuoteBuilder dealId="d6" />, SALES);
    await userEvent.selectOptions(screen.getByLabelText("Add a catalogue item"), "cat4");
    const discount = screen.getByLabelText(/Discount %/);
    await userEvent.clear(discount);
    await userEvent.type(discount, "12");
    await userEvent.click(screen.getByRole("button", { name: /Request approval/ }));
    expect(await screen.findByText("Waiting for Management.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send quote/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New version/ })).toBeInTheDocument();
  });

  it("a role with neither quote permission gets the explained no-access, not a blank page", () => {
    renderAs(<QuoteBuilder dealId="d1" />, DELIVERY);
    expect(screen.getByText(/Quotes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview document/ })).not.toBeInTheDocument();
  });
});

describe("approvals inbox (Q3, FIG-1169)", () => {
  it("declining needs a reason, and the reason is what the requester then sees", async () => {
    renderAs(<Approvals />, MANAGEMENT);
    const card = screen.getByRole("heading", { name: /Mwangaza Schools · Q-2026-032 v2/ }).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Decline" }));
    expect(within(card).getByRole("alert")).toHaveTextContent(/Say why/);
    await userEvent.type(within(card).getByPlaceholderText(/Reason/), "Try 5%");
    await userEvent.click(within(card).getByRole("button", { name: "Decline" }));
    await userEvent.click(screen.getByRole("tab", { name: /Decided/ }));
    expect(screen.getByText(/Declined · Try 5%/)).toBeInTheDocument();
  });

  it("approving moves the request to Decided immediately", async () => {
    renderAs(<Approvals />, MANAGEMENT);
    const before = screen.getByRole("tab", { name: /Waiting/ }).textContent;
    await userEvent.click(within(screen.getByRole("heading", { name: /Leads export/ }).closest("li")!).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Waiting/ }).textContent).not.toBe(before));
  });

  it("a requester sees only their own requests, read-only, with no way to decide", () => {
    renderAs(<Approvals />, SALES);
    expect(screen.getByRole("heading", { name: /Mwangaza Schools/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Leads export/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for Management/)).toBeInTheDocument();
  });
});

describe("forecast and targets (Q4, FIG-1170)", () => {
  it("Management sees the team, values and editable targets; the chart has a text description and a table", async () => {
    renderAs(<Forecast />, MANAGEMENT);
    expect(screen.getByRole("img", { name: /Weighted closes: OCT/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Target for Dev Sales")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Expected closes by month" })).toBeInTheDocument();
  });

  it("Sales sees only their own deals; other people's deals and values are not in the page at all", () => {
    renderAs(<Forecast />, SALES);
    expect(screen.queryByText("Savannah Logistics")).not.toBeInTheDocument(); // Dev Sales Two's deal
    expect(screen.getByText("Kijani Foods Ltd")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Target for/)).not.toBeInTheDocument(); // cannot edit targets
  });

  it("flags a close date that has passed", () => {
    renderAs(<Forecast />, MANAGEMENT);
    expect(screen.getByText(/close date passed/)).toBeInTheDocument(); // Pwani Hotels, 22 Oct
  });
});
