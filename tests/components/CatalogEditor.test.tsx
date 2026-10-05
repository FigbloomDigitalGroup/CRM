import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogEditor, type CatalogEntryRow } from "../../src/app/o/[orgSlug]/settings/CatalogEditor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const ENTRIES: CatalogEntryRow[] = [
  { id: "ls-1", key: "WEBSITE", name: "Website", description: null, isActive: true, usageCount: 2 },
  { id: "ls-2", key: "REFERRAL", name: "Referral", description: null, isActive: true, usageCount: 0 },
];

describe("CatalogEditor", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists entries with their usage count and active status", () => {
    render(
      <CatalogEditor
        orgSlug="figbloom"
        catalogKey="leadSources"
        label="Lead sources"
        entries={ENTRIES}
        variant="plain"
      />,
    );

    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("Referral")).toBeInTheDocument();
    expect(screen.getAllByText("Active")).toHaveLength(2);
  });

  it("adds a new entry via the add form", async () => {
    const user = userEvent.setup();
    render(
      <CatalogEditor
        orgSlug="figbloom"
        catalogKey="leadSources"
        label="Lead sources"
        entries={ENTRIES}
        variant="plain"
      />,
    );

    await user.type(screen.getByLabelText("Name"), "Trade Show");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/reference-catalogs/leadSources",
      expect.objectContaining({ method: "POST" }),
    );
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({ name: "Trade Show" });
  });

  it("deactivates an entry and flips the button to Reactivate", async () => {
    const user = userEvent.setup();
    render(
      <CatalogEditor
        orgSlug="figbloom"
        catalogKey="leadSources"
        label="Lead sources"
        entries={ENTRIES}
        variant="plain"
      />,
    );

    const row = screen.getByText("Referral").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/reference-catalogs/leadSources/ls-2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ isActive: false }),
      }),
    );
  });

  it("disables the up-arrow on the first row and the down-arrow on the last row", () => {
    render(
      <CatalogEditor
        orgSlug="figbloom"
        catalogKey="leadSources"
        label="Lead sources"
        entries={ENTRIES}
        variant="plain"
      />,
    );

    const firstRow = screen.getByText("Website").closest("tr")!;
    const lastRow = screen.getByText("Referral").closest("tr")!;
    expect(within(firstRow).getByRole("button", { name: /Move Website up/ })).toBeDisabled();
    expect(within(lastRow).getByRole("button", { name: /Move Referral down/ })).toBeDisabled();
  });
});
