import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SignClient } from "../../../src/app/sign/[token]/SignClient";
import { canSign, demoSigningFor, totalOf } from "../../../src/app/sign/[token]/demoSigning";

describe("client e-signature page (Q2, FIG-1193)", () => {
  it("a signature needs at least two letters and the tick", () => {
    expect(canSign("Grace Wanjiru", true)).toBe(true);
    expect(canSign("Grace Wanjiru", false)).toBe(false);
    expect(canSign("  1 ", true)).toBe(false);
    expect(canSign("Wú", true)).toBe(true);
  });

  it("signs in three actions: the name is already there, tick, sign", async () => {
    render(<SignClient quote={demoSigningFor("demo-unsigned")} />);
    const sign = screen.getByRole("button", { name: "Sign and accept" });
    await userEvent.click(sign);
    expect(screen.getByRole("alert")).toHaveTextContent(/tick the box/);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(sign);
    expect(screen.getByText("Signed. Thank you.")).toBeInTheDocument();
    expect(screen.getByText(/kept as a record/)).toBeInTheDocument();
    expect(screen.queryByText("Deposit requested")).not.toBeInTheDocument();
  });

  it("switches to Swahili without losing what was typed", async () => {
    render(<SignClient quote={demoSigningFor("demo-unsigned")} />);
    await userEvent.click(screen.getByRole("button", { name: "SW" }));
    expect(screen.getByRole("button", { name: "Saini na ukubali" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Grace Wanjiru")).toBeInTheDocument();
  });

  it("shows the signed quote, and the deposit request only when the quote carries one", () => {
    const { unmount } = render(<SignClient quote={demoSigningFor("demo-signed")} />);
    expect(screen.getByText("Signed. Thank you.")).toBeInTheDocument();
    expect(screen.queryByText("Deposit requested")).not.toBeInTheDocument();
    unmount();
    render(<SignClient quote={demoSigningFor("demo-deposit")} />);
    expect(screen.getByText("Deposit requested")).toBeInTheDocument();
    expect(screen.getAllByText(/KES 175,720/).length).toBeGreaterThan(0); // half of the discounted total (351,440)
  });

  it("an unknown link says only that it is not valid", () => {
    render(<SignClient quote={demoSigningFor("nope")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This link is not valid");
    expect(document.body.textContent).not.toMatch(/Mwangaza|KES/);
  });

  it("totals match the builder's arithmetic", () => {
    const q = demoSigningFor("demo-unsigned")!;
    expect(totalOf(q.lines, q.discountPct)).toBe(Math.round(382_000 * 0.92)); // 12 x 18,500 + 65,000 + 95,000
  });
});
