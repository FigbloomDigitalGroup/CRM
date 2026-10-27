import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  fieldErrorMap,
  FormErrorSummary,
  initialsOf,
  Input,
  Menu,
  OwnerChip,
  Popover,
  ScopePill,
  scopeFromResolution,
  SearchableSelect,
  Select,
  Tabs,
  Tag,
  ToastProvider,
  Tooltip,
  useDirtyGuard,
  useToast,
  type Column,
} from "../../../src/ui";

/** F1.02: behaviour of the component library (keyboard, focus, roles, labels). Axe over the whole gallery is in gallery.test.tsx. */

describe("Button", () => {
  it("calls onClick, and not while loading or blocked with a reason", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button loading onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Save/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("with a reason stays focusable, is announced as unavailable, and says why", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabledReason="Only Management can assign leads." onClick={onClick}>Assign</Button>);
    const button = screen.getByRole("button", { name: "Assign" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await user.tab();
    expect(button).toHaveFocus();
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("Only Management can assign leads.");
    expect(button).toHaveAccessibleDescription("Only Management can assign leads.");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Chip, Tag, Badge, ScopePill, Avatar, OwnerChip", () => {
  it("a removable chip is two separate buttons, not a button in a button", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onToggle = vi.fn();
    const { container } = render(<Chip selected onToggle={onToggle} onRemove={onRemove} removeLabel="Remove Priority">Priority</Chip>);
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Priority" }));
    await user.click(screen.getByRole("button", { name: "Remove Priority" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    render(<Tag>Plain</Tag>);
  });

  it("a status always has its word, so colour is never the only signal", () => {
    render(<Badge tone="danger">Overdue · 3 Oct</Badge>);
    expect(screen.getByText("Overdue · 3 Oct")).toBeVisible();
  });

  it("scope pills carry the word, and a scope resolution maps to the design's pill (no pill for no access)", () => {
    render(<><ScopePill scope="mine" /><ScopePill scope="team" /><ScopePill scope="organisation" /><ScopePill scope="read-only" /></>);
    for (const w of ["Mine", "Team", "Organisation", "Read-only"]) expect(screen.getByText(w)).toBeInTheDocument();
    expect(scopeFromResolution("own")).toBe("mine");
    expect(scopeFromResolution("organisation")).toBe("organisation");
    expect(scopeFromResolution("read-only")).toBe("read-only");
    expect(scopeFromResolution("none")).toBeNull();
  });

  it("avatars fall back to initials when there is no picture or it fails to load", () => {
    expect(initialsOf("Dev Sales Two")).toBe("DT");
    expect(initialsOf("Wafula")).toBe("WA");
    expect(initialsOf("  ")).toBe("?");
    const { container } = render(<Avatar name="Dev Sales" src="/nope.png" />);
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Dev Sales" })).toHaveTextContent("DS");
    render(<OwnerChip name={null} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});

describe("form fields", () => {
  it("ties label, help and error to the control and marks it required and invalid", () => {
    render(<Input label="Email" required help="We never share it." error="Enter a valid email address." />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("We never share it. Enter a valid email address.");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  });

  it("a control that cannot be used says why in words, not in a tooltip", () => {
    render(<Input label="Organisation name" disabledReason="Only Management can change this." defaultValue="Figbloom" />);
    const input = screen.getByLabelText("Organisation name");
    expect(input).toBeDisabled();
    expect(input).toHaveAccessibleDescription("Only Management can change this.");
  });

  it("Select and Checkbox are labelled", async () => {
    const user = userEvent.setup();
    render(<><Select label="Source" placeholder="Choose" options={[{ value: "web", label: "Website" }]} /><Checkbox label="Send email" /></>);
    await user.selectOptions(screen.getByLabelText("Source"), "web");
    expect(screen.getByLabelText("Source")).toHaveValue("web");
    await user.click(screen.getByLabelText("Send email"));
    expect(screen.getByLabelText("Send email")).toBeChecked();
  });

  it("maps the API's field errors to fields, first message winning, nested paths reachable by their last segment", () => {
    expect(fieldErrorMap([{ path: "email", message: "Bad email" }, { path: "email", message: "Second" }, { path: "items.0.name", message: "Required" }])).toEqual({
      email: "Bad email",
      "items.0.name": "Required",
      name: "Required",
    });
    expect(fieldErrorMap(undefined)).toEqual({});
    render(<FormErrorSummary errors={[{ path: "a", message: "A is wrong" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("A is wrong");
  });

  it("warns before unload only while the form is dirty", () => {
    function Probe({ dirty }: { dirty: boolean }) {
      const { confirmDiscard } = useDirtyGuard(dirty);
      return <button onClick={() => (window as unknown as { result: boolean }).result = confirmDiscard()}>go</button>;
    }
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = render(<Probe dirty={false} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByText("go"));
    expect((window as unknown as { result: boolean }).result).toBe(true);

    rerender(<Probe dirty />);
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByText("go"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((window as unknown as { result: boolean }).result).toBe(false);
    confirm.mockRestore();
  });
});

describe("SearchableSelect", () => {
  const options = [{ value: "m", label: "Dev Management" }, { value: "s", label: "Dev Sales" }, { value: "t", label: "Dev Sales Two" }];
  function Harness({ onChange }: { onChange: (v: string | null) => void }) {
    const [v, setV] = useState<string | null>(null);
    return <SearchableSelect label="Owner" options={options} value={v} onChange={(x) => { setV(x); onChange(x); }} />;
  }

  it("filters as you type and chooses with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Owner" });
    await user.click(box);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await user.type(box, "two");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("t");
    expect(box).toHaveValue("Dev Sales Two");
  });

  it("arrow keys move the active option, Escape closes, and an empty search says so", async () => {
    const user = userEvent.setup();
    render(<Harness onChange={() => undefined} />);
    const box = screen.getByRole("combobox", { name: "Owner" });
    await user.click(box);
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", expect.stringMatching(/-1$/));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.type(box, "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("moves with the arrow keys, skips a disabled tab and explains it", async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="Record"
        tabs={[
          { id: "a", label: "Overview", panel: <p>Overview panel</p> },
          { id: "b", label: "Payments", panel: <p>Payments panel</p>, disabledReason: "Payments are visible to Finance and Management only." },
          { id: "c", label: "Activity", panel: <p>Activity panel</p> },
        ]}
      />,
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Overview panel");
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity panel");
    expect(screen.getByRole("tab", { name: "Payments" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("tab", { name: "Payments" })).toHaveAttribute("title", "Payments are visible to Finance and Management only.");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
  });
});

describe("Tooltip, Menu, Popover", () => {
  it("a tooltip shows on focus and hides on Escape", async () => {
    const user = userEvent.setup();
    render(<Tooltip text="Why"><button>Hover</button></Tooltip>);
    await user.tab();
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a menu opens with the arrow key, moves, selects with Enter and returns focus to its button", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onAssign = vi.fn();
    render(
      <Menu
        label="Row actions"
        trigger="Actions"
        items={[
          { key: "edit", label: "Edit", onSelect: onEdit },
          { key: "assign", label: "Assign", disabledReason: "Only Sales leads can assign.", onSelect: onAssign },
          { key: "archive", label: "Archive", danger: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Assign/ })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: /Assign/ })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Enter}");
    expect(onAssign).not.toHaveBeenCalled();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("a popover closes on Escape and on a press outside", async () => {
    const user = userEvent.setup();
    render(<div><Popover label="Filters" trigger="Open"><p>Inside</p></Popover><button>Outside</button></div>);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Dialog, ConfirmDialog, Drawer", () => {
  it("a dialog traps focus, closes on Escape and gives focus back", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Rename view" actions={<button>Save</button>}>
            <Input label="Name" />
          </Dialog>
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Rename view" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByLabelText("Name")).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByLabelText("Name")).toHaveFocus(); // wrapped, did not leave the dialog
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("a confirm dialog shows progress while it works, closes on success, and stays open with the reason on failure", async () => {
    const user = userEvent.setup();
    let fail = true;
    const onConfirm = vi.fn(async () => {
      if (fail) throw new Error("The lead is locked by another change.");
    });
    const onClose = vi.fn();
    render(<ConfirmDialog open onClose={onClose} title="Archive this lead?" body="It can be restored." confirmLabel="Archive" tone="danger" onConfirm={onConfirm} />);
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The lead is locked by another change.");
    expect(onClose).not.toHaveBeenCalled();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("a drawer is a labelled modal with a close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="New lead"><p>Form</p></Drawer>);
    const drawer = await screen.findByRole("dialog", { name: "New lead" });
    await user.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Toasts", () => {
  function Trigger({ undo }: { undo?: () => void }) {
    const toast = useToast();
    return <button onClick={() => toast.show({ message: "Stage moved to Qualified.", undo })}>Move</button>;
  }

  it("an undo toast runs the undo and goes away", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    render(<ToastProvider><Trigger undo={undo} /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("status")).toHaveTextContent("Stage moved to Qualified.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Stage moved to Qualified.")).toBeNull();
  });

  it("goes after the five-second undo window, but not while the person is reaching for it", () => {
    vi.useFakeTimers();
    try {
      render(<ToastProvider><Trigger undo={() => undefined} /></ToastProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
      const toast = screen.getByText("Stage moved to Qualified.").closest("[role=status]")!;
      act(() => void vi.advanceTimersByTime(4500));
      expect(screen.getByText("Stage moved to Qualified.")).toBeInTheDocument();
      fireEvent.mouseEnter(toast);
      act(() => void vi.advanceTimersByTime(20000));
      expect(screen.getByText("Stage moved to Qualified.")).toBeInTheDocument(); // held while hovered
      fireEvent.mouseLeave(toast);
      act(() => void vi.advanceTimersByTime(5100));
      expect(screen.queryByText("Stage moved to Qualified.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an error toast is announced at once", async () => {
    const user = userEvent.setup();
    function Err() {
      const toast = useToast();
      return <button onClick={() => toast.show({ tone: "danger", message: "Could not save." })}>Fail</button>;
    }
    render(<ToastProvider><Err /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
  });
});

describe("DataTable", () => {
  interface Row { id: string; name: string; score: number; note: string }
  const rows: Row[] = [
    { id: "1", name: "Wafula", score: 82, note: "alpha" },
    { id: "2", name: "Kamau", score: 41, note: "beta" },
    { id: "3", name: "Njeri", score: 67, note: "gamma" },
  ];
  const columns: Column<Row>[] = [
    { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name, alwaysVisible: true },
    { key: "score", header: "Score", cell: (r) => r.score, sortValue: (r) => r.score },
    { key: "note", header: "Note", cell: (r) => r.note, sortValue: (r) => r.note, hiddenByDefault: true },
  ];
  const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").find((c) => c.textContent && /Wafula|Kamau|Njeri/.test(c.textContent))?.textContent);

  it("sorts by a column, ascending then descending then back, and says so for screen readers", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Leads" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    await user.click(screen.getByRole("button", { name: /Score/ }));
    expect(names()).toEqual(["Kamau", "Njeri", "Wafula"]);
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: /Score/ }));
    expect(names()).toEqual(["Wafula", "Njeri", "Kamau"]);
    await user.click(screen.getByRole("button", { name: /Score/ }));
    expect(names()).toEqual(["Wafula", "Kamau", "Njeri"]);
  });

  it("hands sorting to the server when it is told to", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(<DataTable caption="Leads" columns={columns} rows={rows} rowKey={(r) => r.id} sort={null} onSortChange={onSortChange} />);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", dir: "asc" });
    expect(names()).toEqual(["Wafula", "Kamau", "Njeri"]); // rows are shown as given
  });

  it("filters, and says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Leads" columns={columns} rows={rows} rowKey={(r) => r.id} filterable filterLabel="Filter leads" />);
    await user.type(screen.getByRole("searchbox", { name: "Filter leads" }), "kam");
    expect(names()).toEqual(["Kamau"]);
    await user.clear(screen.getByRole("searchbox", { name: "Filter leads" }));
    await user.type(screen.getByRole("searchbox", { name: "Filter leads" }), "zzz");
    expect(screen.getByText("No rows match that filter.")).toBeInTheDocument();
  });

  it("selects rows and all rows, shows the bulk bar, and keeps read-only rows out with the reason", async () => {
    const user = userEvent.setup();
    const bulk = vi.fn();
    render(
      <DataTable
        caption="Leads"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.name}
        selectable
        rowDisabledReason={(r) => (r.id === "2" ? "Read-only: owned by another team." : undefined)}
        bulkActions={(sel) => <button onClick={() => bulk(sel.map((r) => r.id))}>Assign</button>}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select Kamau" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Kamau" })).toHaveAttribute("title", "Read-only: owned by another team.");
    await user.click(screen.getByRole("checkbox", { name: "Select Wafula" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("1 selected");
    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("2 selected");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(bulk).toHaveBeenCalledWith(["1", "3"]);
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("lets the person choose columns, and always keeps the name column", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Leads" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("columnheader", { name: "Note" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.queryByRole("checkbox", { name: "Name" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Note" }));
    expect(screen.getByRole("columnheader", { name: "Note" })).toBeInTheDocument();
  });

  it("shows skeleton rows while loading and the empty state when there is nothing", () => {
    const { rerender } = render(<DataTable caption="Leads" columns={columns} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    rerender(<DataTable caption="Leads" columns={columns} rows={[]} rowKey={(r) => r.id} empty={<p>No leads yet</p>} />);
    expect(screen.getByText("No leads yet")).toBeInTheDocument();
  });
});
