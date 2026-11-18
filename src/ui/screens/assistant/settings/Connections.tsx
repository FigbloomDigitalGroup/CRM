"use client";

import { Calendar, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/basics";
import { ConfirmDialog } from "../../../components/overlays";
import { LoadingState } from "../../../components/states";
import { useToast } from "../../../components/toast";
import { useApiMutation, useApiQuery } from "../../../data/hooks";
import { useMember } from "../../../data/member";
import { describeError } from "../../../errors";
import { QueryFailure } from "../../../featureUnavailable";
import { Panel } from "../../settings/kit";

type Kind = "EMAIL" | "CALENDAR";
type Provider = "GOOGLE" | "MICROSOFT";

interface ConnectionItem {
  id: string | null;
  kind: Kind;
  provider: Provider | null;
  state: "CONNECTED" | "NEEDS_RECONNECT" | "DISCONNECTED";
  stateReason: string;
  accountEmail: string | null;
  shared?: boolean;
}

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "GOOGLE", label: "Google Workspace" },
  { value: "MICROSOFT", label: "Microsoft 365" },
];

const DEFS: { kind: Kind; title: string; detail: string; consent: string }[] = [
  {
    kind: "EMAIL",
    title: "Mail",
    detail: "Emails to and from known contacts are added to their timeline, and you can send from Figbloom with your own address.",
    consent:
      "You will sign in with your provider. Figbloom asks to read your mail and to send mail you write in Figbloom, and only files messages to and from people already in your contacts. You can disconnect at any time and the access is revoked.",
  },
  {
    kind: "CALENDAR",
    title: "Calendar",
    detail: "Meetings with contacts appear as activities, and meeting links are created in your own calendar.",
    consent: "You will sign in with your provider. Figbloom asks to read your meetings and to add the ones you schedule in Figbloom. You can disconnect at any time.",
  },
];

/**
 * Settings, Email and calendar (S6#2, FIG-1175): connect and disconnect your own mailbox and calendar through the provider's own sign-in
 * (OAuth, docs/OAUTH_CONNECTIONS.md). Status, start and disconnect are the real API; tokens never reach the browser.
 */
export function Connections() {
  const { orgSlug } = useMember();
  const toast = useToast();
  const list = useApiQuery("getIntegrationsConnections", { params: { orgSlug } });
  const start = useApiMutation("postIntegrationsConnectionsStart");
  const remove = useApiMutation("deleteIntegrationsConnectionsByConnectionId", { invalidate: [["getIntegrationsConnections"]] });
  const [provider, setProvider] = useState<Provider>("GOOGLE");
  const [consent, setConsent] = useState<Kind | null>(null);
  const [disconnect, setDisconnect] = useState<ConnectionItem | null>(null);
  const [starting, setStarting] = useState(false);

  // The provider sends the person back here with the outcome in the address (the callback route).
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("connection");
    if (outcome === "connected") toast.show({ message: "Connected.", tone: "success" });
    else if (outcome === "denied") toast.show({ message: "The provider did not allow the connection. Nothing was connected.", tone: "danger" });
  }, []);

  const items = ((list.data as { items?: ConnectionItem[] } | undefined)?.items ?? []) as ConnectionItem[];

  function begin(kind: Kind) {
    setConsent(null);
    setStarting(true);
    start.mutate(
      { params: { orgSlug }, body: { kind, provider } as never },
      {
        onSuccess: (r) => {
          const url = (r as { authorizationUrl?: string }).authorizationUrl;
          if (url) window.location.assign(url);
          else setStarting(false);
        },
        onError: (e) => {
          setStarting(false);
          toast.show({ message: describeError(e).body, tone: "danger" });
        },
      },
    );
  }

  return (
    <div className="fb-set-cols" style={{ maxWidth: "none", gridTemplateColumns: "1fr" }}>
      {list.isPending ? <LoadingState label="Loading your connections" lines={3} /> : null}
      {list.isError ? <QueryFailure error={list.error} area="Your connections" onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <div className="fb-set-cards">
          {DEFS.map((def) => {
            const item = items.find((i) => i.kind === def.kind);
            // The API leaves out a kind this role cannot use.
            if (!item) return null;
            const Icon = def.kind === "EMAIL" ? Mail : Calendar;
            const connected = item.state === "CONNECTED";
            const providerLabel = PROVIDERS.find((p) => p.value === item.provider)?.label;
            return (
              <Panel
                key={def.kind}
                title={
                  <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                    <Icon size={18} aria-hidden="true" />
                    {def.title}
                  </span>
                }
                description={def.detail}
              >
                {!connected ? (
                  <fieldset className="fb-set-code" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, border: 0 }}>
                    <legend className="fb-sr-only">{def.title} provider</legend>
                    {PROVIDERS.map((p) => (
                      <label key={p.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="radio" name={`provider-${def.kind}`} checked={provider === p.value} onChange={() => setProvider(p.value)} /> {p.label}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {item.state === "NEEDS_RECONNECT" ? <p className="fb-set-muted">{item.stateReason}</p> : null}
                <div className="fb-set-panel__actions">
                  {connected ? (
                    <>
                      <span className="fb-set-pill fb-set-pill--ok">
                        Connected{providerLabel ? ` · ${providerLabel}` : ""}
                        {item.accountEmail ? ` · ${item.accountEmail}` : ""}
                      </span>
                      {item.shared ? <span className="fb-set-muted">Shared by your organisation</span> : <Button onClick={() => setDisconnect(item)}>Disconnect</Button>}
                    </>
                  ) : (
                    <Button variant="primary" disabled={starting} onClick={() => setConsent(def.kind)}>
                      {item.state === "NEEDS_RECONNECT" ? `Reconnect ${def.title.toLowerCase()}` : `Connect ${def.title.toLowerCase()}`}
                    </Button>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      ) : null}

      <ConfirmDialog
        open={consent !== null}
        onClose={() => setConsent(null)}
        title="Allow Figbloom to connect?"
        body={DEFS.find((d) => d.kind === consent)?.consent ?? ""}
        confirmLabel="Continue to sign in"
        onConfirm={() => begin(consent!)}
      />
      <ConfirmDialog
        open={disconnect !== null}
        onClose={() => setDisconnect(null)}
        title="Disconnect?"
        body="Figbloom stops reading from this account and the access is revoked. What was already added to timelines stays."
        confirmLabel="Disconnect"
        onConfirm={() => {
          const c = disconnect!;
          setDisconnect(null);
          remove.mutate(
            { params: { orgSlug, connectionId: c.id! } },
            {
              onSuccess: () => toast.show({ message: "Disconnected. Access was revoked." }),
              onError: (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
            },
          );
        }}
      />
    </div>
  );
}
