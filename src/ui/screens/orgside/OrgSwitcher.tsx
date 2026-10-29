"use client";

import { Check, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { Popover } from "../../components/overlays";
import { useToast } from "../../components/toast";
import { DemoBadge } from "../../demo/DemoBadge";
import { orgSideDemo, useOrgSideDemo } from "./demo/store";

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
 * TB4, the organisation switcher (FIG-1165): for people who belong to several organisations. The list shows the role they hold in each, unread
 * counts, a pending invitation with Accept, and a suspended organisation as disabled with the reason. Alt+O opens it. Switching says where you
 * are now (or why it could not), and an offline attempt keeps you where you were. On demo data until B6.01 lands.
 */
export function OrgSwitcher() {
  const toast = useToast();
  const demo = useOrgSideDemo();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = demo.memberships.find((m) => m.id === demo.currentOrg) ?? demo.memberships[0]!;
  const list = demo.memberships.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));

  function pick(id: string, close: () => void) {
    const m = demo.memberships.find((x) => x.id === id)!;
    if (m.invite) {
      orgSideDemo.accept(id);
      toast.show({ message: `Joined ${m.name} as ${m.role}`, tone: "success" });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.show({ message: `Couldn’t switch: you’re offline. You’re still in ${current.name}.`, tone: "danger" });
      return;
    }
    orgSideDemo.switchTo(id);
    toast.show({ message: `Now in ${m.name} as ${m.role}. Demo only: this page stays on ${current.name} until the real switcher is wired.` });
    close();
  }

  return (
    <Popover
      label="Switch organisation"
      align="end"
      open={open}
      onOpenChange={setOpen}
      className="fb-orgsw"
      triggerClassName="fb-roundbtn"
      trigger={<Repeat size={17} aria-hidden="true" />}
    >
      {(close) => (
        <div data-screen-label="TB4 Organisation switcher">
          <div className="fb-orgsw__head">
            <span className="fb-orgsw__eyebrow">SWITCH ORGANISATION · ALT+O</span>
            <DemoBadge />
          </div>
          {demo.memberships.length > 6 ? (
            <input className="fb-orgsw__search" aria-label="Find an organisation" placeholder="Find an organisation" value={q} onChange={(e) => setQ(e.target.value)} />
          ) : null}
          <ul className="fb-orgsw__list">
            {list.map((m) => {
              const isCur = m.id === demo.currentOrg;
              const disabled = Boolean(m.suspended) || isCur;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="fb-orgsw__item"
                    data-current={isCur || undefined}
                    aria-disabled={disabled || undefined}
                    aria-current={isCur ? "true" : undefined}
                    onClick={() => {
                      if (!disabled) pick(m.id, close);
                    }}
                  >
                    <span className="fb-orgsw__tile" style={{ background: m.suspended ? "#878a83" : TILE_COLOURS[m.name.length % 4] }} aria-hidden="true">
                      {initials(m.name)}
                    </span>
                    <span className="fb-orgsw__text">
                      <span className="fb-orgsw__name">{m.name}</span>
                      <span className="fb-orgsw__meta">
                        {m.suspended ? m.suspended : m.invite ? `Pending invitation · ${m.role}` : `${m.id === "o1" ? "Management" : m.role} · ${isCur ? "here now" : `last visited ${m.last}`}`}
                      </span>
                    </span>
                    {!isCur && !m.invite && m.unread ? <span className="fb-orgsw__unread">{m.unread}</span> : null}
                    {isCur ? <Check size={15} aria-label="Current organisation" /> : null}
                    {m.invite ? <span className="fb-orgsw__accept">Accept</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Popover>
  );
}
