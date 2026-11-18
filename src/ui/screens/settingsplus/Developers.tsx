"use client";

import { Copy, ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Checkbox, ConfirmDialog, Dialog, FormErrorSummary, Input, ReleaseTag, useMember, useToast } from "@/ui";
import { Panel } from "../settings/kit";
import { deliveries as seedDeliveries, EVENTS, tokens as seedTokens, webhooks as seedHooks, type DemoDelivery, type DemoToken, type DemoWebhook } from "./demo/data";
import { AuditTrail, recordAudit } from "./kit";
import { TOKEN_SCOPES, generateSecret, maskSecret, validateToken, validateWebhook } from "./model";

/**
 * Developers (S8#2, FIG-1194): API tokens and webhook endpoints for connecting Figbloom's own systems. A token's secret is shown once, when it is
 * made; afterwards only its last characters are kept. Revoking is immediate and says that calls using the token now fail. A webhook's "Send test"
 * puts a delivery in the log you can see, and a failed delivery shows its retries. Demo data until B7.06 (public API) is wired.
 */
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function DevelopersEditor() {
  const { userName, can } = useMember();
  const toast = useToast();
  const [tokens, setTokens] = useState<DemoToken[]>(seedTokens);
  const [hooks, setHooks] = useState<DemoWebhook[]>(seedHooks);
  const [log, setLog] = useState<DemoDelivery[]>(seedDeliveries);

  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [revoking, setRevoking] = useState<DemoToken | null>(null);

  const [addingHook, setAddingHook] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [hookErrors, setHookErrors] = useState<string[]>([]);

  const mayTokens = can("api_tokens.manage");
  const mayHooks = can("webhooks.manage");

  function createToken() {
    const errs = validateToken(name, scopes);
    setErrors(errs);
    if (errs.length) return;
    const value = generateSecret("fbk_live_", random);
    setTokens([...tokens, { id: `tk${tokens.length + 1}`, name: name.trim(), scopes, used: "never", mask: maskSecret(value) }]);
    recordAudit("Developers", "API token created", `${name.trim()} (${scopes.join(", ")})`, userName);
    setSecret({ title: `Token “${name.trim()}”`, value });
    setMaking(false);
    setName("");
    setScopes([]);
  }

  function createHook() {
    const errs = validateWebhook(url, events);
    setHookErrors(errs);
    if (errs.length) return;
    const value = generateSecret("whsec_", random);
    setHooks([...hooks, { id: `wh${hooks.length + 1}`, url: url.trim(), events, ok: true, last: "No deliveries yet" }]);
    recordAudit("Developers", "Webhook added", url.trim(), userName);
    setSecret({ title: "Signing secret", value });
    setAddingHook(false);
    setUrl("");
    setEvents([]);
  }

  function sendTest(h: DemoWebhook) {
    const d: DemoDelivery = { id: `dl${log.length + 1}`, hookId: h.id, event: "test.ping", status: h.ok ? "200 OK" : "503 Service Unavailable", attempts: 1, next: h.ok ? "—" : "in 5 min", at: "just now" };
    setLog([d, ...log]);
    setHooks(hooks.map((x) => (x.id === h.id ? { ...x, last: `${d.status} · just now` } : x)));
    toast.show({ message: `Test event sent to ${h.url}. ${h.ok ? "It was accepted." : "It failed and will be retried."}`, tone: h.ok ? "success" : "danger" });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.show({ message: "Copied", tone: "success" });
    } catch {
      toast.show({ message: "Could not copy. Select it and copy by hand.", tone: "danger" });
    }
  }

  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <>
      
      <Panel
        title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>API tokens <ReleaseTag release="v2" /></span>}
        description="Tokens let a script or another system read or write CRM data. A token can do only what its scopes allow."
        actions={
          <>
            <a className="fb-btn fb-btn--secondary" href="/api/openapi.json" target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> API docs</a>
            <Button variant="primary" disabledReason={mayTokens ? undefined : "Only Management creates tokens"} onClick={() => setMaking(true)}><Plus size={15} aria-hidden="true" /> New token</Button>
          </>
        }
        flush
      >
        {tokens.length === 0 ? <p className="fb-set-row fb-set-muted">No tokens yet.</p> : null}
        {tokens.map((t) => (
          <div key={t.id} className="fb-set-row">
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">{t.name}</div>
              <div className="fb-set-row__meta">{t.scopes.join(", ")} · last used {t.used}</div>
            </div>
            <code className="fb-set-code fb-sp-mask" aria-label={`Token ${t.name}`}>{t.mask}</code>
            <Button variant="danger" size="sm" disabledReason={mayTokens ? undefined : "Only Management revokes tokens"} onClick={() => setRevoking(t)}>Revoke</Button>
          </div>
        ))}
      </Panel>

      <Panel
        title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>Webhooks <ReleaseTag release="v2" /></span>}
        description="Figbloom calls these addresses when something happens. Failed calls are retried up to five times."
        actions={<Button variant="primary" disabledReason={mayHooks ? undefined : "Only Management adds webhooks"} onClick={() => setAddingHook(true)}><Plus size={15} aria-hidden="true" /> New endpoint</Button>}
        flush
      >
        {hooks.map((h) => (
          <div key={h.id} className="fb-set-row">
            <span className={`fb-set-dot${h.ok ? "" : " fb-set-dot--bad"}`} aria-hidden="true" />
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">{h.url}</div>
              <div className="fb-set-row__meta">{h.events.join(", ")}</div>
            </div>
            <span className={h.ok ? "fb-set-muted" : "fb-com-bad"}>{h.last}</span>
            <Button size="sm" disabledReason={mayHooks ? undefined : "Only Management sends tests"} onClick={() => sendTest(h)}>Send test</Button>
          </div>
        ))}
      </Panel>

      <Panel title="Delivery log and retries" description="The latest deliveries. A failed one shows how many tries were made and when the next is due." level={3} flush>
        <div className="fb-set-tablewrap">
          <table className="fb-com-table">
            <caption className="fb-sr-only">Webhook deliveries</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Endpoint</th><th scope="col">Event</th><th scope="col">Result</th><th scope="col" className="fb-com-num">Tries</th><th scope="col">Next try</th><th scope="col"><span className="fb-sr-only">Retry</span></th></tr></thead>
            <tbody>
              {log.map((d) => {
                const hook = hooks.find((h) => h.id === d.hookId);
                const failed = !d.status.startsWith("200");
                return (
                  <tr key={d.id}>
                    <td>{d.at}</td>
                    <td>{hook?.url ?? "—"}</td>
                    <td>{d.event}</td>
                    <td className={failed ? "fb-com-bad" : undefined}>{d.status}</td>
                    <td className="fb-com-num">{d.attempts}</td>
                    <td>{d.next}</td>
                    <td>
                      {failed && d.next !== "gave up" ? (
                        <Button size="sm" disabledReason={mayHooks ? undefined : "Only Management retries"} onClick={() => { setLog(log.map((x) => (x.id === d.id ? { ...x, attempts: x.attempts + 1, status: "200 OK", next: "—", at: "just now" } : x))); toast.show({ message: "Delivered on retry", tone: "success" }); }}>Retry now</Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <AuditTrail area="Developers" />

      <Dialog open={making} onClose={() => setMaking(false)} title="New API token" actions={<><Button onClick={() => setMaking(false)}>Cancel</Button><Button variant="primary" onClick={createToken}>Create token</Button></>}>
        {errors.length ? <FormErrorSummary errors={errors.map((message, i) => ({ path: `e${i}`, message }))} /> : null}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} help="What will use it, for example “Accounting sync”." />
        <fieldset className="fb-sp-scopes">
          <legend className="fb-com-eyebrow">Scopes</legend>
          {TOKEN_SCOPES.map((s) => <Checkbox key={s} label={s} checked={scopes.includes(s)} onChange={(e) => setScopes(toggle(scopes, s, e.target.checked))} />)}
        </fieldset>
      </Dialog>

      <Dialog open={addingHook} onClose={() => setAddingHook(false)} title="New webhook endpoint" actions={<><Button onClick={() => setAddingHook(false)}>Cancel</Button><Button variant="primary" onClick={createHook}>Add endpoint</Button></>}>
        {hookErrors.length ? <FormErrorSummary errors={hookErrors.map((message, i) => ({ path: `e${i}`, message }))} /> : null}
        <Input label="Endpoint address" value={url} placeholder="https://example.co.ke/hooks/crm" onChange={(e) => setUrl(e.target.value)} />
        <fieldset className="fb-sp-scopes">
          <legend className="fb-com-eyebrow">Events</legend>
          {EVENTS.map((s) => <Checkbox key={s} label={s} checked={events.includes(s)} onChange={(e) => setEvents(toggle(events, s, e.target.checked))} />)}
        </fieldset>
      </Dialog>

      <Dialog open={secret !== null} dismissible={false} onClose={() => setSecret(null)} title={secret?.title ?? ""} actions={<Button variant="primary" onClick={() => setSecret(null)}>I have saved it</Button>}>
        <Banner tone="warning" title="Copy it now.">This is the only time it is shown. If you lose it, revoke it and make a new one.</Banner>
        <div className="fb-set-keyrow">
          <code className="fb-set-code" data-testid="secret-once">{secret?.value}</code>
          <Button onClick={() => secret && void copy(secret.value)}><Copy size={15} aria-hidden="true" /> Copy</Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke “${revoking?.name ?? ""}”?`}
        tone="danger"
        confirmLabel="Revoke now"
        body="Calls using this token stop working immediately. This cannot be undone; make a new token if it is needed again."
        onConfirm={() => {
          if (!revoking) return;
          setTokens(tokens.filter((t) => t.id !== revoking.id));
          recordAudit("Developers", "API token revoked", revoking.name, userName);
          toast.show({ message: `${revoking.name} revoked. Calls using it now fail.`, tone: "success" });
          setRevoking(null);
        }}
      />
    </>
  );
}
