import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch, SearchResults, resultHref } from "../../../../src/ui/screens/home/Search";
import { expectNoAxeViolations, renderScreen, type Handlers } from "./harness";

/** F2.11 (G2): the top-bar search and the results page, by keyboard, with the API deciding what a role may find. */

const push = vi.fn();
const replace = vi.fn();
let query = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/o/figbloom/search",
  useSearchParams: () => new URLSearchParams(query),
}));

const hit = (id: string, label: string, sublabel: string | null = null, archived = false) => ({ id, label, sublabel, archived });
const group = (type: string, items: ReturnType<typeof hit>[], total = items.length) => ({ type, items, page: 1, pageSize: 5, total, pageCount: 1, nextCursor: null });

function searchHandlers(over: Partial<Handlers> = {}): Handlers {
  return {
    getSearchRecents: () => ({ recents: [{ query: "wanjiku", lastUsedAt: "2026-10-26T10:00:00Z" }, { query: "java", lastUsedAt: "2026-10-25T10:00:00Z" }] }),
    postSearchRecents: () => ({ recents: [] }),
    deleteSearchRecents: () => ({ cleared: 2 }),
    search: ({ query: q }) =>
      String(q?.q).toLowerCase().startsWith("java")
        ? {
            query: q?.q,
            tooShort: false,
            total: 4,
            groups: [
              group("companies", [hit("c1", "Java House Africa", "Hospitality")]),
              group("contacts", [hit("p1", "Wanjiru Kamau", "Java House Africa")]),
              group("leads", [hit("l1", "Java House Africa", "Wanjiru Kamau")]),
              group("deals", []),
              group("tasks", [hit("t1", "Call Java House", "Due today")]),
            ],
            hidden: { someResultsHidden: true, unavailableGroups: [], limitedToYours: ["leads", "deals", "tasks"] },
          }
        : { query: q?.q, tooShort: false, total: 0, groups: GROUPS.map((t) => group(t, [])), hidden: { someResultsHidden: false } },
    ...over,
  };
}
const GROUPS = ["leads", "companies", "contacts", "deals", "tasks"];

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  query = "";
});

describe("the top-bar search", () => {
  it("is a combobox that lists grouped results in the design's order, with the kind on each row", async () => {
    const user = userEvent.setup();
    renderScreen(<GlobalSearch />, searchHandlers(), { roleName: "Sales" });
    const box = screen.getByRole("combobox", { name: "Search records" });
    await user.type(box, "java");
    await screen.findByRole("option", { name: /Call Java House/ }, { timeout: 4000 });
    const list = screen.getByRole("listbox", { name: "Search results" });
    const options = within(list).getAllByRole("option");
    // Leads, companies, contacts, deals, tasks; then the link to the full page.
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Java House Africa"), // lead
      expect.stringContaining("Java House Africa"), // company
      expect.stringContaining("Wanjiru Kamau"),
      expect.stringContaining("Call Java House"),
      expect.stringContaining("See all results for “java”"),
    ]);
    expect(options[0]).toHaveTextContent("Lead");
    expect(options[1]).toHaveTextContent("Company");
    expect(within(list).getByText(/Only records your Sales role can open are included/)).toBeInTheDocument();
  });

  it("is fully usable by keyboard: arrows move, Enter opens the highlighted result, Enter with none opens the full page, Escape closes", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<GlobalSearch />, searchHandlers());
    const box = screen.getByRole("combobox", { name: "Search records" });
    await user.type(box, "java");
    await screen.findByRole("option", { name: /Call Java House/ });
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", expect.stringContaining("r-leads-l1"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/o/figbloom/contacts/p1");
    await waitFor(() => expect(r.last("postSearchRecents")).toMatchObject({ body: { query: "java" } }));

    push.mockClear();
    await user.clear(box);
    await user.type(box, "java");
    await screen.findByRole("option", { name: /Call Java House/ });
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/o/figbloom/search?q=java");

    await user.type(box, "{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens a task by its row on the Tasks page, and everything else by its own page", () => {
    expect(resultHref("figbloom", "tasks", "t1")).toBe("/o/figbloom/tasks#task-t1");
    expect(resultHref("figbloom", "deals", "d1")).toBe("/o/figbloom/deals/d1");
    expect(resultHref("figbloom", "companies", "c1")).toBe("/o/figbloom/companies/c1");
  });

  it("offers recent searches before you type, and can clear them", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<GlobalSearch />, searchHandlers());
    await user.click(screen.getByRole("combobox", { name: "Search records" }));
    expect(await screen.findByText("RECENT SEARCHES")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /wanjiku/ })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /java/ }));
    expect(screen.getByRole("combobox", { name: "Search records" })).toHaveValue("java");
    await user.clear(screen.getByRole("combobox", { name: "Search records" }));
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(r.count("deleteSearchRecents")).toBe(1));
  });

  it("says plainly when nothing is found in what the role can open", async () => {
    const user = userEvent.setup();
    renderScreen(<GlobalSearch />, searchHandlers());
    await user.type(screen.getByRole("combobox", { name: "Search records" }), "zzzz");
    expect(await screen.findByText("No matches in records you can access.")).toBeInTheDocument();
  });

  it("does not ask the server for fewer than two characters", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<GlobalSearch />, searchHandlers());
    await user.type(screen.getByRole("combobox", { name: "Search records" }), "j");
    await new Promise((res) => setTimeout(res, 350));
    expect(r.count("search")).toBe(0);
  });

  it("answers a failed search with a message in the panel, not a crash", async () => {
    const user = userEvent.setup();
    renderScreen(<GlobalSearch />, searchHandlers({ search: () => Promise.reject({ status: 503, envelope: { requestId: "r", fieldErrors: [] } }) }));
    await user.type(screen.getByRole("combobox", { name: "Search records" }), "java");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Search did not respond/);
  });

  it("has no axe violations with the results open", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen(<GlobalSearch />, searchHandlers());
    await user.type(screen.getByRole("combobox", { name: "Search records" }), "java");
    await screen.findByRole("option", { name: /Call Java House/ });
    await expectNoAxeViolations(container);
  });
});

describe("the results page", () => {
  it("shows each kind with its count, a tab for each, and the role-limit note", async () => {
    query = "q=java";
    const { container } = renderScreen(<SearchResults />, searchHandlers(), { roleName: "Sales" });
    expect(await screen.findByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
    expect(screen.getByText(/Results only include records your role \(Sales\) can open/)).toBeInTheDocument();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["All4", "Leads1", "Companies1", "Contacts1", "Deals0", "Tasks1"]);
    expect(await screen.findByRole("heading", { name: /Companies/ })).toBeInTheDocument();
    expect(screen.getByText("Hospitality")).toBeInTheDocument();
    expect(screen.getByText(/can only open your own leads, deals, tasks/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("a type tab searches only that kind, and the address keeps the choice", async () => {
    const user = userEvent.setup();
    query = "q=java";
    const r = renderScreen(<SearchResults />, searchHandlers());
    await user.click(await screen.findByRole("tab", { name: /Companies/ }));
    expect(replace).toHaveBeenCalledWith("/o/figbloom/search?q=java&type=companies");
    expect(r.calls.some((c) => c.id === "search")).toBe(true);
  });

  it("explains a kind the role cannot search instead of leaving it out silently", async () => {
    query = "q=java";
    const handlers = searchHandlers({
      search: () => ({ query: "java", tooShort: false, total: 1, groups: [group("tasks", [hit("t1", "Call Java House")]), group("companies", []), group("contacts", []), group("leads", []), group("deals", [])], hidden: { someResultsHidden: true, unavailableGroups: ["companies", "contacts", "leads", "deals"].map((type) => ({ type, reason: "Your role does not include this." })), limitedToYours: [] } }),
    });
    renderScreen(<SearchResults />, handlers, { roleName: "Restricted Technical" });
    expect(await screen.findByText("Call Java House")).toBeInTheDocument();
    const notes = screen.getAllByRole("note");
    expect(notes.map((n) => n.textContent).join(" ")).toMatch(/Companies are not part of your Restricted Technical workspace/);
    expect(screen.queryByRole("tab", { name: /Companies/ })).toBeNull();
  });

  it("says no results in the design's words", async () => {
    query = "q=zzzz";
    renderScreen(<SearchResults />, searchHandlers());
    expect(await screen.findByText("No results for “zzzz”")).toBeInTheDocument();
    expect(screen.getByText("Try a company name, a phone number or part of an email.")).toBeInTheDocument();
  });

  it("asks for more than one character before searching", async () => {
    query = "q=j";
    const r = renderScreen(<SearchResults />, searchHandlers());
    expect(await screen.findByText("Keep typing")).toBeInTheDocument();
    expect(r.count("search")).toBe(0);
  });
});
