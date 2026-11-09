import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Connections } from "../../../../src/ui/screens/assistant/settings/Connections";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";

const MGMT = { permissionKeys: ["configuration.manage", "communications.create", "activities.create"], roleName: "Management" };

const item = (over: Record<string, unknown>) => ({ id: null, kind: "EMAIL", provider: null, state: "DISCONNECTED", stateReason: "Disconnected. Access was revoked.", accountEmail: null, shared: false, mine: true, ...over });

afterEach(() => vi.unstubAllGlobals());

describe("Settings, Email and calendar (FIG-1175) is wired to the OAuth connection API", () => {
  it("starts a connection through the API and sends the person to the provider's sign-in", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    const { client, calls } = stubClient({
      getIntegrationsConnections: () => ({ items: [item({}), item({ kind: "CALENDAR" })] }),
      postIntegrationsConnectionsStart: () => ({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" }),
    });
    const { container } = renderScreen(<Connections />, client, MGMT);
    await userEvent.click(await screen.findByRole("button", { name: "Connect mail" }));
    // The consent text is honest about what is asked, then the provider takes over.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/read your mail and to send mail you write in Figbloom/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to sign in" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=abc"));
    expect(calls.find((c) => c.id === "postIntegrationsConnectionsStart")?.args).toMatchObject({ params: { orgSlug: "figbloom" }, body: { kind: "EMAIL", provider: "GOOGLE" } });
    expect(await violations(container)).toEqual([]);
  });

  it("shows a connected account and disconnects it through the API", async () => {
    let connected = true;
    const { client, calls } = stubClient({
      getIntegrationsConnections: () => ({ items: [connected ? item({ id: "c-1", provider: "MICROSOFT", state: "CONNECTED", accountEmail: "dev@brookside.example" }) : item({}), item({ kind: "CALENDAR" })] }),
      deleteIntegrationsConnectionsByConnectionId: () => {
        connected = false;
        return { ok: true };
      },
    });
    renderScreen(<Connections />, client, MGMT);
    expect(await screen.findByText(/Connected · Microsoft 365 · dev@brookside.example/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls.find((c) => c.id === "deleteIntegrationsConnectionsByConnectionId")?.args).toMatchObject({ params: { orgSlug: "figbloom", connectionId: "c-1" } }));
    expect(await screen.findByRole("button", { name: "Connect mail" })).toBeInTheDocument();
  });

  it("offers a reconnect when the provider refused the connection, and leaves out a kind the role cannot use", async () => {
    const { client } = stubClient({
      getIntegrationsConnections: () => ({ items: [item({ id: "c-2", provider: "GOOGLE", state: "NEEDS_RECONNECT", stateReason: "The provider no longer accepts this connection. Connect again to keep syncing." })] }),
    });
    renderScreen(<Connections />, client, MGMT);
    expect(await screen.findByRole("button", { name: "Reconnect mail" })).toBeInTheDocument();
    expect(screen.getByText(/no longer accepts this connection/)).toBeInTheDocument();
    expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
  });

  it("explains a provider that is not configured instead of failing silently, and a failed load can be retried", async () => {
    const { client } = stubClient({
      getIntegrationsConnections: () => ({ items: [item({})] }),
      postIntegrationsConnectionsStart: () => apiError(400, "Google sign-in is not set up on this server."),
    });
    renderScreen(<Connections />, client, MGMT);
    await userEvent.click(await screen.findByRole("button", { name: "Connect mail" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Continue to sign in" }));
    expect(await screen.findByText(/not set up on this server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect mail" })).not.toBeDisabled();
  });

  it("reports the outcome the callback puts in the address, with no demo storage", async () => {
    vi.stubGlobal("location", { ...window.location, search: "?tab=connect&connection=denied" });
    const { client } = stubClient({ getIntegrationsConnections: () => ({ items: [item({})] }) });
    renderScreen(<Connections />, client, MGMT);
    expect(await screen.findByText(/did not allow the connection/)).toBeInTheDocument();
    expect(Object.keys(localStorage).filter((k) => k.includes("demo"))).toEqual([]);
  });
});
