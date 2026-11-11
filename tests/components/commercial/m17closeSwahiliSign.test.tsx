import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/app/sign/[token]/actions", () => ({ signQuoteAction: vi.fn() }));

import { LiveSign, type SignState } from "../../../src/app/sign/[token]/LiveSign";

/** FIG-1189 (B7.07) close-out: the live signing page per language, switchable with no sign-in. Snapshots of the rendered page content. */

const PAGE = {
  organisationName: "Figbloom Digital",
  quoteNumber: "Q-2026-0001",
  version: 1,
  company: "Mwangaza Schools",
  currency: "KES",
  validUntil: "2026-12-04",
  terms: "50% deposit.",
  lines: [{ description: "CCTV camera", unit: "camera", quantity: 2, unitPrice: 18500, lineTotal: 37000 }],
  subtotal: 37000,
  discountPercent: 10,
  discountAmount: 3700,
  total: 33300,
  recipientEmail: "x@example.test",
};

const state = (documentLanguage: "en" | "sw"): SignState => ({ status: "ok", page: { ...PAGE, documentLanguage } });

describe("the live signing page per language", () => {
  it("snapshot: English", () => {
    const { container } = render(<LiveSign token="t" state={state("en")} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("snapshot: Swahili", () => {
    const { container } = render(<LiveSign token="t" state={state("sw")} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("snapshot: expired link, Swahili", () => {
    const { container } = render(<LiveSign token="t" state={{ status: "expired", organisationName: "Figbloom Digital", language: "sw" }} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("starts in the document's language and the visitor can switch both ways, with no sign-in", async () => {
    render(<LiveSign token="t" state={state("sw")} />);
    expect(screen.getByRole("button", { name: "Saini na ukubali" })).toBeInTheDocument();
    expect(screen.getByText(/4 Desemba 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("button", { name: "Sign and accept" })).toBeInTheDocument();
    expect(screen.getByText(/4 December 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "SW" }));
    expect(screen.getByRole("button", { name: "Saini na ukubali" })).toBeInTheDocument();
  });

  it("shows only what the client may see: no cost, margin or internal wording, in either language", async () => {
    render(<LiveSign token="t" state={state("en")} />);
    for (const lang of ["EN", "SW"]) {
      await userEvent.click(screen.getByRole("button", { name: lang }));
      expect(document.body.textContent).not.toMatch(/cost|margin|internal|gharama|faida/i);
    }
  });
});
