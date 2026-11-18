import { act, render, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "../screens/home/harness";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardToCapture, scanSummary } from "../../../src/ui/screens/mobile/capture/cardExtract";
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

const CARD_HANDLERS = {
  postQuickCaptureCards: () => ({ capture: { id: "cap-1" }, upload: { url: "/api/storage/blob?x=1", method: "PUT" } }),
  postQuickCaptureCardsByCaptureIdExtract: () => ({ fields: { name: "Achieng Otieno", company: "Lakeview Hotels", title: "Marketing Manager", phone: "+254 722 410 088", email: "achieng@lakeview.co.ke" }, unsure: ["phone"], note: null, duplicates: [] }),
};

describe("business card capture asks before saving (on the real API)", () => {
  it("flags the fields the reader was unsure of and always asks for a check", () => {
    const text = scanSummary({ name: "A B", unsure: ["phone"], note: null });
    expect(text).toMatch(/Not sure about the phone/);
    expect(text).toMatch(/Check the fields before saving/);
  });

  it("says what the server said when nothing could be read", () => {
    expect(scanSummary({ name: "", unsure: [], note: "Automatic reading is not set up. Type the details in." })).toMatch(/not set up. Type the details in. Check the fields/);
  });

  it("declares the photo, uploads it, asks the server to read it, and only fills the form; nothing is confirmed by the scan", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    const onScanned = vi.fn<(s: Scanned) => void>();
    const user = userEvent.setup();
    const view = renderScreen(<ScanCard onScanned={onScanned} />, CARD_HANDLERS);
    await user.upload(screen.getByLabelText("Photograph a business card"), new File(["x"], "card.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(onScanned).toHaveBeenCalledTimes(1));
    expect(view.last("postQuickCaptureCards")?.body).toMatchObject({ name: "card.jpg", mimeType: "image/jpeg", sizeBytes: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/storage/blob?x=1", expect.objectContaining({ method: "PUT" }));
    expect(view.count("postQuickCaptureCardsByCaptureIdConfirm")).toBe(0);
    const s = onScanned.mock.calls[0]![0];
    expect(s.captureId).toBe("cap-1");
    expect(Object.keys(s.fields).sort()).toEqual(["email", "name", "note", "phone"]);
    expect(s.unsure).toEqual(["phone"]);
    expect(s.summary).toMatch(/Check the fields before saving/);
    globalThis.fetch = realFetch;
  });

  it("explains a refused photo and leaves the form alone", async () => {
    const onScanned = vi.fn();
    const user = userEvent.setup();
    renderScreen(<ScanCard onScanned={onScanned} />, {
      postQuickCaptureCards: () => {
        throw { status: 422, envelope: { code: "VALIDATION_FAILED", message: "A business card must be a photo (JPEG, PNG or WebP).", requestId: "r", fieldErrors: [] } };
      },
    });
    await user.upload(screen.getByLabelText("Photograph a business card"), new File(["x"], "card.heic", { type: "image/heic" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("must be a photo");
    expect(onScanned).not.toHaveBeenCalled();
  });

  it("the banner asks for a check", () => {
    const fields = cardToCapture({ name: "A B", company: "Co", title: "Dir", phone: "1", email: "a@b.c" });
    act(() => undefined);
    render(<ScannedBanner scanned={{ fields, summary: "Read it. Check the fields before saving.", unsure: [] }} />);
    expect(screen.getByTestId("scan-banner")).toHaveTextContent("Check the fields before saving");
  });
});
