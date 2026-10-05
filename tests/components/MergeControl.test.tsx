import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergeControl } from "../../src/app/o/[orgSlug]/_shared/MergeControl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const OPTIONS = [
  { id: "winner-1", label: "Acme Ltd" },
  { id: "winner-2", label: "Acme Holdings" },
];

describe("MergeControl", () => {
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

  it("renders nothing without permission or without any merge candidates", () => {
    const { container: noPermission } = render(
      <MergeControl
        orgSlug="figbloom"
        basePath="companies/1"
        bodyKey="intoCompanyId"
        options={OPTIONS}
        canMerge={false}
      />,
    );
    expect(noPermission).toBeEmptyDOMElement();

    const { container: noOptions } = render(
      <MergeControl
        orgSlug="figbloom"
        basePath="companies/1"
        bodyKey="intoCompanyId"
        options={[]}
        canMerge={true}
      />,
    );
    expect(noOptions).toBeEmptyDOMElement();
  });

  it("requires a second click to confirm before actually merging", async () => {
    const user = userEvent.setup();
    render(
      <MergeControl
        orgSlug="figbloom"
        basePath="companies/1"
        bodyKey="intoCompanyId"
        options={OPTIONS}
        canMerge={true}
      />,
    );

    const button = screen.getByRole("button", { name: "Merge into selected" });
    await user.click(button);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirm merge/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Confirm merge/ }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/companies/1/merge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ intoCompanyId: "winner-1" }),
      }),
    );
  });

  it("resets the confirm step when the selected target changes", async () => {
    const user = userEvent.setup();
    render(
      <MergeControl
        orgSlug="figbloom"
        basePath="contacts/1"
        bodyKey="intoContactId"
        options={OPTIONS}
        canMerge={true}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Merge into selected" }));
    expect(screen.getByRole("button", { name: /Confirm merge/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "winner-2");

    expect(screen.getByRole("button", { name: "Merge into selected" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
