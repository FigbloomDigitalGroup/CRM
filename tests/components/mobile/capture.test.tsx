import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardToCapture, extractCard, scanSummary } from "../../../src/ui/screens/mobile/capture/cardExtract";
import { addPhoto, readPhotos, retryPhotos } from "../../../src/ui/screens/mobile/capture/photos";
import { ScanCard, ScannedBanner, type Scanned } from "../../../src/ui/screens/mobile/capture/ScanCard";

beforeEach(() => localStorage.clear());

describe("photos on the phone (M4, FIG-1177)", () => {
  it("a photo taken online is sent at once", () => {
    const p = addPhoto("lead:1", { name: "a.jpg", size: 1_800_000 }, true);
    expect(p).toMatchObject({ state: "SENT", size: "1.8 MB" });
  });

  it("a photo taken offline waits, and a retry while still offline changes nothing", () => {
    const p = addPhoto("lead:1", { name: "b.jpg", size: 900 }, false);
    expect(p.state).toBe("WAITING");
    expect(retryPhotos(false)).toBe(0);
    expect(readPhotos().find((x) => x.id === p.id)!.state).toBe("WAITING");
  });

  it("retrying online sends what waits, once", () => {
    addPhoto("lead:1", { name: "c.jpg", size: 5000 }, false);
    addPhoto("lead:1", { name: "d.jpg", size: 5000 }, false);
    expect(retryPhotos(true)).toBe(2);
    expect(retryPhotos(true)).toBe(0);
    expect(readPhotos().every((p) => p.state === "SENT")).toBe(true);
  });
});

describe("business card capture asks before saving", () => {
  it("flags the fields the reader was unsure of and always asks for a check", async () => {
    const card = await extractCard(null);
    const text = scanSummary({ ...card, unsure: ["phone"] });
    expect(text).toMatch(/Not sure about the phone/);
    expect(text).toMatch(/Check the fields before saving/);
  });

  it("only fills the form fields; nothing is saved by the scan", async () => {
    const onScanned = vi.fn<(s: Scanned) => void>();
    const user = userEvent.setup();
    render(<ScanCard onScanned={onScanned} />);
    await user.upload(screen.getByLabelText("Photograph a business card"), new File(["x"], "card.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(onScanned).toHaveBeenCalledTimes(1));
    const s = onScanned.mock.calls[0]![0];
    expect(Object.keys(s.fields).sort()).toEqual(["email", "name", "note", "phone"]);
    expect(s.summary).toMatch(/Check the fields before saving/);
  });

  it("the banner says it is a demo reading", () => {
    const fields = cardToCapture({ name: "A B", company: "Co", title: "Dir", phone: "1", email: "a@b.c", unsure: [] });
    act(() => undefined);
    render(<ScannedBanner scanned={{ fields, summary: "Read it. Check the fields before saving.", unsure: [] }} />);
    expect(screen.getByTestId("scan-banner")).toHaveTextContent("Demo reading");
  });
});
