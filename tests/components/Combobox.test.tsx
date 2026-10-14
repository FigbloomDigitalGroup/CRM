import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, type ComboOption } from "../../src/app/o/[orgSlug]/_shared/Combobox";

const OPTIONS: ComboOption[] = [
  { value: "m-1", label: "Amina Otieno", sublabel: "Sales", avatarLabel: "AO" },
  { value: "m-2", label: "Brian Kamau", sublabel: "Management", avatarLabel: "BK" },
  { value: "m-3", label: "Unassigned" },
];

function Controlled({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Combobox
      value={value}
      options={OPTIONS}
      ariaLabel="Owner"
      placeholder="Pick an owner"
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("Combobox", () => {
  it("shows the placeholder, or the selected label with its sublabel", () => {
    const { rerender } = render(
      <Combobox value="" options={OPTIONS} onChange={() => {}} placeholder="Pick an owner" />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Pick an owner");

    rerender(<Combobox value="m-2" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("button")).toHaveTextContent("Brian Kamau (Management)");

    rerender(<Combobox value="m-3" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("button")).toHaveTextContent("Unassigned");
  });

  it("opens a listbox on click and selects an option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Owner" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("AO")).toBeInTheDocument();

    await user.click(screen.getByText("Brian Kamau"));
    expect(onChange).toHaveBeenCalledWith("m-2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("Brian Kamau (Management)");
  });

  it("marks the current value as selected when reopened", async () => {
    const user = userEvent.setup();
    render(<Combobox value="m-1" options={OPTIONS} onChange={() => {}} ariaLabel="Owner" />);

    await user.click(screen.getByRole("button", { name: "Owner" }));
    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveClass("is-active");
    expect(second).toHaveAttribute("aria-selected", "false");
  });

  it("supports keyboard navigation: open, move, select and escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Owner" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("m-2");
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking outside, scrolling, or toggling the trigger", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const trigger = screen.getByRole("button", { name: "Owner" });

    await user.click(trigger);
    fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(trigger);
    fireEvent.scroll(window);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(trigger);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open when disabled", async () => {
    const user = userEvent.setup();
    render(<Combobox value="" options={OPTIONS} onChange={() => {}} disabled ariaLabel="Owner" />);

    await user.click(screen.getByRole("button", { name: "Owner" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
