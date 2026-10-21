import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "../../src/app/o/[orgSlug]/_shared/GlobalSearch";

const RESULTS = {
  companies: [{ id: "c1", label: "Acme Ltd", sublabel: "Cape Town" }],
  contacts: [],
  leads: [{ id: "l1", label: "Acme website lead", sublabel: null }],
  deals: [],
  tasks: [{ id: "t1", label: "Call Acme", sublabel: "Due today" }],
};

const EMPTY = { companies: [], contacts: [], leads: [], deals: [], tasks: [] };

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("GlobalSearch (FIG-787)", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.unstubAllGlobals();
  });

  it("does not call the API for a query shorter than two characters", async () => {
    const fetchMock = mockFetch(RESULTS);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);

    await user.type(screen.getByRole("combobox"), "a");
    await new Promise((r) => setTimeout(r, 400));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("searches the org's endpoint and shows results grouped by type", async () => {
    const fetchMock = mockFetch(RESULTS);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);

    await user.type(screen.getByRole("combobox"), "acme");

    expect(await screen.findByText("Acme Ltd")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/figbloom/search?q=acme");
    expect(screen.getByText("Companies")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.queryByText("Contacts")).toBeNull();
    expect(screen.getByText("Cape Town")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    mockFetch(EMPTY);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);

    await user.type(screen.getByRole("combobox"), "zzz");

    expect(await screen.findByText(/No matches for "zzz"/)).toBeInTheDocument();
  });

  it("keeps the panel closed after a failed request", async () => {
    mockFetch({}, false);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);

    await user.type(screen.getByRole("combobox"), "acme");

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText("Acme Ltd")).toBeNull();
  });

  it("opens a clicked result, with tasks landing on the Tasks list anchor", async () => {
    mockFetch(RESULTS);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);
    await user.type(screen.getByRole("combobox"), "acme");

    await user.click(await screen.findByText("Call Acme"));

    expect(window.location.href).toBe("/o/figbloom/tasks#task-t1");
  });

  it("navigates with the arrow keys and opens the active result on Enter", async () => {
    mockFetch(RESULTS);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);
    const input = screen.getByRole("combobox");
    await user.type(input, "acme");
    await screen.findByText("Acme Ltd");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(window.location.href).toBe("/o/figbloom/leads/l1");
  });

  it("opens the first result on Enter when nothing is highlighted", async () => {
    mockFetch(RESULTS);
    const user = userEvent.setup();
    render(<GlobalSearch orgSlug="figbloom" />);
    await user.type(screen.getByRole("combobox"), "acme");
    await screen.findByText("Acme Ltd");

    await user.keyboard("{Enter}");

    expect(window.location.href).toBe("/o/figbloom/companies/c1");
  });

  it("closes the panel on Escape and on a click outside", async () => {
    mockFetch(RESULTS);
    const user = userEvent.setup();
    render(
      <div>
        <GlobalSearch orgSlug="figbloom" />
        <button>elsewhere</button>
      </div>,
    );
    await user.type(screen.getByRole("combobox"), "acme");
    await screen.findByText("Acme Ltd");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("focuses the box on '/' and Ctrl+K, but ignores '/' while typing in another field", () => {
    render(
      <div>
        <GlobalSearch orgSlug="figbloom" />
        <input aria-label="other" />
      </div>,
    );
    const search = screen.getByRole("combobox");

    fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();

    (search as HTMLInputElement).blur();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(search).toHaveFocus();

    const other = screen.getByLabelText("other");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(search).not.toHaveFocus();
  });
});
