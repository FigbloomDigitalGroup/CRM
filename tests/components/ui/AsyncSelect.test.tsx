import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AsyncSelect, type SelectOption } from "../../../src/ui/components/forms";

const ALL: SelectOption[] = [
  { value: "c1", label: "Acacia Foods" },
  { value: "c2", label: "Baobab Ltd" },
  { value: "c3", label: "Savannah Hotels" },
];

/** Stands in for the server: the options are whatever matches the last search text. */
function Harness({ onSearchSpy, onChangeSpy, minChars = 0 }: { onSearchSpy: (t: string) => void; onChangeSpy?: (v: string | null) => void; minChars?: number }) {
  const [text, setText] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const options = ALL.filter((o) => o.label.toLowerCase().includes(text.toLowerCase()));
  return (
    <AsyncSelect
      label="Company"
      value={value}
      options={options}
      minChars={minChars}
      debounceMs={20}
      onSearch={(t) => {
        onSearchSpy(t);
        setText(t);
      }}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
    />
  );
}

describe("AsyncSelect", () => {
  it("hands the typed text to the caller once typing pauses, not on every key", async () => {
    const spy = vi.fn();
    render(<Harness onSearchSpy={spy} />);
    const box = screen.getByRole("combobox", { name: "Company" });
    await userEvent.click(box);
    await userEvent.type(box, "sav");
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("sav"));
    const texts = spy.mock.calls.map((c) => c[0]);
    expect(texts).not.toContain("s");
    expect(texts).not.toContain("sa");
    expect(await screen.findByRole("option", { name: "Savannah Hotels" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Acacia Foods" })).toBeNull();
  });

  it("keeps showing the chosen label after the option is no longer in the loaded rows", async () => {
    const onChange = vi.fn();
    render(<Harness onSearchSpy={() => {}} onChangeSpy={onChange} />);
    const box = screen.getByRole("combobox", { name: "Company" });
    await userEvent.click(box);
    await userEvent.type(box, "baob");
    await userEvent.click(await screen.findByRole("option", { name: "Baobab Ltd" }));
    expect(onChange).toHaveBeenCalledWith("c2");
    expect(box).toHaveValue("Baobab Ltd");
    // A later search that does not return Baobab must not blank the field.
    await userEvent.click(box);
    await userEvent.type(box, "zzz");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(box).toHaveValue("Baobab Ltd"));
  });

  it("shows the label a caller passes for an existing value that is not in the loaded rows", () => {
    render(<AsyncSelect label="Company" value="c9" selectedLabel="Existing Co" options={[]} onSearch={() => {}} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Company" })).toHaveValue("Existing Co");
  });

  it("asks for more letters instead of listing when minChars is not met, and picks with the keyboard", async () => {
    const onChange = vi.fn();
    render(<Harness onSearchSpy={() => {}} onChangeSpy={onChange} minChars={2} />);
    const box = screen.getByRole("combobox", { name: "Company" });
    await userEvent.click(box);
    expect(await screen.findByText(/Type at least 2 letters/)).toBeInTheDocument();
    await userEvent.type(box, "ac");
    await screen.findByRole("option", { name: "Acacia Foods" });
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("c1");
  });

  it("shows the empty text when nothing matches", async () => {
    render(<Harness onSearchSpy={() => {}} />);
    const box = screen.getByRole("combobox", { name: "Company" });
    await userEvent.click(box);
    await userEvent.type(box, "nothing like it");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });
});
