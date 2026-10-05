import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveControl } from "../../src/app/o/[orgSlug]/_shared/ArchiveControl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("ArchiveControl", () => {
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

  it("renders nothing when the caller lacks permission", () => {
    const { container } = render(
      <ArchiveControl orgSlug="figbloom" basePath="leads/1" archivedAt={null} canArchive={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("posts to the archive endpoint and refreshes on success", async () => {
    const user = userEvent.setup();
    render(
      <ArchiveControl orgSlug="figbloom" basePath="leads/1" archivedAt={null} canArchive={true} />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/leads/1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows Restore and the archived timestamp once archived, and posts to restore", async () => {
    const user = userEvent.setup();
    const archivedAt = "2026-01-15T10:00:00.000Z";
    render(
      <ArchiveControl orgSlug="figbloom" basePath="companies/9" archivedAt={archivedAt} canArchive={true} />,
    );

    expect(screen.getByText(/Archived/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/companies/9/restore",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error and does not refresh when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Nope." }) }),
    );
    const user = userEvent.setup();
    render(
      <ArchiveControl orgSlug="figbloom" basePath="leads/1" archivedAt={null} canArchive={true} />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
