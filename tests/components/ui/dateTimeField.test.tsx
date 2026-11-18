import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DateTimeField } from "../../../src/ui";

const NOW = new Date("2026-11-18T05:00:00Z"); // Wednesday 08:00 in Nairobi

function Harness({ initial = "", onChange, hour12 = false, required = false }: { initial?: string; onChange?: (iso: string) => void; hour12?: boolean; required?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimeField
      label="Next follow-up"
      value={value}
      required={required}
      onChange={(iso) => {
        setValue(iso);
        onChange?.(iso);
      }}
      timeZone="Africa/Nairobi"
      hour12={hour12}
      now={NOW}
    />
  );
}

describe("DateTimeField (P2-27): one date-and-time input for every follow-up", () => {
  it("shows the stored instant as a date and a time in the person's zone, and the time zone", () => {
    render(<Harness initial="2026-11-20T12:30:00.000Z" />);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("Time")).toHaveValue("15:30");
    expect(screen.getByText(/Time zone: Africa\/Nairobi \(UTC\+3\)/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Next follow-up/ })).toBeInTheDocument();
  });

  it("chooses the time in steps of 5 minutes and saves an ISO instant", async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-11-20T12:30:00.000Z" onChange={onChange} />);
    const time = screen.getByLabelText("Time");
    expect(time.querySelectorAll("option")).toHaveLength(288);
    await userEvent.selectOptions(time, "17:45");
    expect(onChange).toHaveBeenLastCalledWith("2026-11-20T14:45:00.000Z");
  });

  it("labels the times for a 12 hour clock when that is the person's preference", () => {
    render(<Harness initial="2026-11-20T12:30:00.000Z" hour12 />);
    expect(screen.getByRole("option", { name: "3:30 PM" })).toBeInTheDocument();
    expect(screen.getByText("Today 5:00 PM")).toBeInTheDocument();
  });

  it("choosing only a date takes the default time (09:00); the time is never lost", async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-11-20T12:30:00.000Z" onChange={onChange} />);
    // The date moves; the chosen time stays.
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-25" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-25T12:30:00.000Z");
  });

  it("starts empty with the default time when a date is typed first", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-25" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-25T06:00:00.000Z");
  });

  it("offers the quick choices: Today 17:00, Tomorrow 09:00, Next week", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Today 17:00" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-18T14:00:00.000Z");
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow 09:00" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-19T06:00:00.000Z");
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-23T06:00:00.000Z");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-23");
    expect(screen.getByLabelText("Time")).toHaveValue("09:00");
  });

  it("warns, without blocking, when the time has already passed", () => {
    render(<Harness initial="2026-11-17T12:00:00.000Z" />);
    expect(screen.getByRole("status")).toHaveTextContent("That time has already passed.");
  });

  it("an existing time that is not on the 5 minute grid is shown as stored", () => {
    render(<Harness initial="2026-11-20T12:32:00.000Z" />);
    expect(screen.getByLabelText("Time")).toHaveValue("15:32");
  });

  it("can be cleared when optional, and not when required", async () => {
    const onChange = vi.fn();
    const { unmount } = render(<Harness initial="2026-11-20T12:30:00.000Z" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    unmount();
    render(<Harness initial="2026-11-20T12:30:00.000Z" required />);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });
});
