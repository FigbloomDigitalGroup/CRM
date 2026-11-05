"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingState } from "../../components/states";
import { useToast } from "../../components/toast";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { useMyOrganisations, useSwitchOrganisation } from "./api";

const TILE_COLOURS = ["#3a69a8", "#7650b0", "#a95a06", "#275b3a"];

function initials(name: string) {
  return name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * TB4, the organisation switcher (FIG-1165): for people who belong to several organisations. The list shows the role they hold in each
 * (`GET /api/me/organizations`, the person's own active memberships only). Picking one switches the session (`POST /api/me/organizations/switch`)
 * and opens that organisation. Alt+O opens it. An offline attempt keeps you where you were and says so.
 *
 * It lives inside the identity popover, below the session details, as in the design; the layout mounts it only for people with more than one
 * organisation. The API lists active organisations only, so suspended or pending ones do not appear here (suspension shows the paused screen, OS1).
 */
export function OrgSwitcher() {
  const toast = useToast();
  const q = useMyOrganisations();
  const switchTo = useSwitchOrganisation();
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        document.querySelector<HTMLElement>(".fb-orgblock__trigger")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = q.data?.items ?? [];
  const current = items.find((m) => m.current);
  const list = items.filter((m) => !search || m.name.toLowerCase().includes(search.toLowerCase()));

  function pick(slug: string, name: string, role: string) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.show({ message: `Couldn’t switch: you’re offline.${current ? ` You’re still in ${current.name}.` : ""}`, tone: "danger" });
      return;
    }
    switchTo.mutate(slug, {
      onSuccess: () => {
        toast.show({ message: `Now in ${name} as ${role}.` });
        // A full load: the shell, the permissions and the look all belong to the organisation.
        window.location.assign(`/o/${slug}`);
      },
      onError: (e) => toast.show({ message: `Couldn’t switch: ${describeError(e).body}`, tone: "danger" }),
    });
  }

  return (
    <div data-screen-label="TB4 Organisation switcher" className="fb-orgsw">
      <div className="fb-orgsw__head">
        <span className="fb-orgsw__eyebrow">SWITCH ORGANISATION · ALT+O</span>
      </div>
      {q.isPending ? <LoadingState label="Loading your organisations" lines={2} /> : null}
      {q.isError ? <QueryFailure error={q.error} area="Your organisations" onRetry={() => void q.refetch()} /> : null}
      {items.length > 6 ? (
        <input className="fb-orgsw__search" aria-label="Find an organisation" placeholder="Find an organisation" value={search} onChange={(e) => setSearch(e.target.value)} />
      ) : null}
      <ul className="fb-orgsw__list">
        {list.map((m) => (
          <li key={m.membershipId}>
            <button
              type="button"
              className="fb-orgsw__item"
              data-current={m.current || undefined}
              aria-disabled={m.current || switchTo.isPending || undefined}
              aria-current={m.current ? "true" : undefined}
              onClick={() => {
                if (!m.current && !switchTo.isPending) pick(m.slug, m.name, m.roleName);
              }}
            >
              <span className="fb-orgsw__tile" style={{ background: TILE_COLOURS[m.name.length % 4] }} aria-hidden="true">
                {initials(m.name)}
              </span>
              <span className="fb-orgsw__text">
                <span className="fb-orgsw__name">{m.name}</span>
                <span className="fb-orgsw__meta">{m.current ? `${m.roleName} · here now` : m.roleName}</span>
              </span>
              {m.current ? <Check size={15} aria-label="Current organisation" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
