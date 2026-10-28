import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceTab, previewDateTime } from "../../../../src/ui/screens/preferences/AppearanceTab";
import { PreferencesScreen } from "../../../../src/ui/screens/preferences/PreferencesScreen";
import { stubClient, violations, apiError } from "../deals/harness";
import { prefsView, renderPrefs } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/preferences",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => localStorage.clear());

describe("Preferences · Appearance (F4.01, AP2)", () => {
  it("shows the tabs and opens on Appearance", async () => {
    const { client } = stubClient({ getMyPreferences: () => prefsView() });
    renderPrefs(<PreferencesScreen />, client);
    expect(screen.getByRole("tab", { name: /Appearance/ })).toHaveAttribute("aria-selected", "true");
    for (const name of ["Profile", "Notifications", "Security"]) expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /Forest/ })).toBeChecked();
  });

  it("a theme changes the app at once and is saved to the account", async () => {
    const { client, calls } = stubClient({ getMyPreferences: () => prefsView(), updateMyPreferences: ({ body }) => prefsView({ appearance: { ...prefsView().appearance, theme: (body as { theme: string }).theme, effective: { ...prefsView().appearance.effective, theme: "OCEAN", colours: { sidebar: "#14365C", accent: "#1F5FA3", highlight: "#E1EEF8", page: { key: "WHITE", label: "White", hex: "#FAF9F7", dark: false } } } } }) });
    renderPrefs(<AppearanceTab resetOpen={false} onResetClose={() => undefined} />, client);
    const ocean = await screen.findByRole("radio", { name: /Ocean/ });
    await userEvent.click(ocean);
    // Applied before the server answers: the live look carries the new sidebar colour.
    await waitFor(() => expect(document.getElementById("fb-look")?.textContent).toContain("#14365C"));
    await waitFor(() => expect(calls.find((c) => c.id === "updateMyPreferences")?.args.body).toEqual({ theme: "OCEAN" }));
    expect(await screen.findByText("Theme: Ocean.")).toBeInTheDocument();
  });

  it("puts a change back and says why when the server refuses it", async () => {
    const { client } = stubClient({ getMyPreferences: () => prefsView(), updateMyPreferences: () => apiError(500, "boom") });
    renderPrefs(<AppearanceTab resetOpen={false} onResetClose={() => undefined} />, client);
    await userEvent.click(await screen.findByRole("radio", { name: /Ocean/ }));
    expect(await screen.findByText(/did not go through/i)).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("fb-look")?.textContent).not.toContain("#14365C"));
  });

  it("text size and accessibility are device-only: stored locally, never sent to the API", async () => {
    const { client, calls } = stubClient({ getMyPreferences: () => prefsView() });
    renderPrefs(<AppearanceTab resetOpen={false} onResetClose={() => undefined} />, client);
    await userEvent.click(await screen.findByRole("radio", { name: "Largest" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Higher contrast/ }));
    const stored = JSON.parse(localStorage.getItem("figbloom-device-prefs")!);
    expect(stored).toMatchObject({ textSize: "EXTRA_LARGE", higherContrast: true });
    expect(document.querySelector(".fb-app")).toHaveAttribute("data-fb-text", "EXTRA_LARGE");
    expect(calls.some((c) => c.id === "updateMyPreferences")).toBe(false);
  });

  it("density saves to the account and applies at once", async () => {
    const { client, calls } = stubClient({ getMyPreferences: () => prefsView(), updateMyPreferences: () => prefsView({ appearance: { ...prefsView().appearance, density: "COMPACT" } }) });
    renderPrefs(<AppearanceTab resetOpen={false} onResetClose={() => undefined} />, client);
    await userEvent.click(await screen.findByRole("radio", { name: "Compact" }));
    await waitFor(() => expect(document.querySelector(".fb-app")).toHaveAttribute("data-fb-density", "compact"));
    expect(calls.find((c) => c.id === "updateMyPreferences")?.args.body).toEqual({ density: "COMPACT" });
  });

  it("reset asks first, restores the defaults and offers Undo", async () => {
    const { client, calls } = stubClient({
      getMyPreferences: () => prefsView({ appearance: { ...prefsView().appearance, density: "COMPACT" } }),
      resetMyAppearance: () => ({ preferences: prefsView(), undo: { token: "tok", expiresAt: "2026-10-28T12:10:00Z", expiresInSeconds: 600 } }),
      undoMyReset: () => prefsView(),
    });
    function Host() {
      return <PreferencesScreen />;
    }
    renderPrefs(<Host />, client);
    await screen.findByRole("radio", { name: /Forest/ });
    await userEvent.click(screen.getByRole("button", { name: /Reset to default/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reset appearance to default?" });
    expect(calls.some((c) => c.id === "resetMyAppearance")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(calls.some((c) => c.id === "resetMyAppearance")).toBe(true));
    expect(await screen.findByText("Appearance reset to default.")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".fb-app")).toHaveAttribute("data-fb-density", "comfortable"));
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "undoMyReset")?.args.body).toEqual({ token: "tok" }));
  });

  it("a locked, shared look is read-only with the reason and who can change it (AP5)", async () => {
    const locked = prefsView({ personalisation: { allowed: false, locked: true, ownColoursAvailable: false }, appearance: { ...prefsView().appearance, effective: { ...prefsView().appearance.effective, locked: true } } });
    const { client, calls } = stubClient({ getMyPreferences: () => locked, updateMyPreferences: () => locked });
    renderPrefs(<AppearanceTab resetOpen={false} onResetClose={() => undefined} />, client);
    const note = await screen.findByTestId("prefs-shared-look");
    expect(note).toHaveTextContent("Your organisation uses a shared look");
    expect(note).toHaveTextContent("Text size, density and accessibility are still yours");
    const ocean = screen.getByRole("radio", { name: /Ocean/ });
    expect(ocean).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText(/Ask a Management member to change it in Settings/).length).toBeGreaterThan(0);
    await userEvent.click(ocean);
    expect(calls.some((c) => c.id === "updateMyPreferences")).toBe(false);
    // What is still theirs works.
    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(document.querySelector(".fb-app")).toHaveAttribute("data-fb-text", "LARGE");
  });

  it("start page, sidebar and the date and time choices save to the account, with a preview", async () => {
    const { client, calls } = stubClient({ getMyPreferences: () => prefsView(), updateMyPreferences: () => prefsView() });
    renderPrefs(<AppearanceTab resetOpen={false} onResetClose={() => undefined} />, client);
    await userEvent.selectOptions(await screen.findByLabelText("After sign-in, open"), "leads");
    await waitFor(() => expect(calls.find((c) => c.id === "updateMyPreferences")?.args.body).toEqual({ startPage: "leads" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Tasks" }));
    await waitFor(() => expect(calls.filter((c) => c.id === "updateMyPreferences").at(-1)?.args.body).toEqual({ sidebar: { hidden: ["tasks"] } }));
    expect(previewDateTime("YMD", "H24", "SUN")).toBe("2026-10-19, 15:12 · week starts Sunday");
    expect(screen.getByTestId("prefs-dt-preview")).toHaveTextContent("19 Oct 2026, 3:12 PM · week starts Monday");
  });

  it("has no accessibility violations", async () => {
    const { client } = stubClient({ getMyPreferences: () => prefsView() });
    const { container } = renderPrefs(<PreferencesScreen />, client);
    await screen.findByRole("radio", { name: /Forest/ });
    expect(await violations(container)).toEqual([]);
  });
});
