"use client";

import { Eye, Info, X } from "lucide-react";
import { Button } from "../../components/basics";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { DemoBadge } from "../../demo/DemoBadge";
import { DEMO_ANNOUNCEMENT } from "./demo/data";
import { orgSideDemo, useOrgSideDemo } from "./demo/store";

/**
 * What the organisation always sees about Figbloom's own staff and platform messages (OS2, OS3, OS5; FIG-1192, organisation side):
 * the approval card for Management, the banner while support is looking (ending is one click, for Management), and the announcement banner
 * (dismissible). Rendered above the page by the shell. On demo data until the V2 backend (B7.x) exists.
 */
export function OrgBanners() {
  const demo = useOrgSideDemo();
  const { canAny } = useMember();
  const toast = useToast();
  const isManagement = canAny("configuration.manage", "organization.manage_settings");
  const pending = demo.support.find((s) => s.status === "Pending organisation approval");
  const active = demo.support.find((s) => s.status === "Active");

  return (
    <>
      {active ? (
        <div role="status" data-screen-label="OS3 Support access banner" className="fb-orgban fb-orgban--support">
          <Eye size={16} aria-hidden="true" />
          <span>
            Figbloom Support is viewing {active.scope.replace(" (read-only)", "").toLowerCase()} (read-only) until {active.expires ?? "the end of the session"}. Customer values stay masked.
          </span>
          {isManagement ? (
            <button
              type="button"
              className="fb-orgban__end"
              onClick={() => {
                orgSideDemo.endSupport(active.id, "You");
                toast.show({ message: "Support access ended. It is recorded in the access history.", tone: "success" });
              }}
            >
              End now
            </button>
          ) : null}
        </div>
      ) : null}
      {!demo.announcementDismissed ? (
        <div role="status" data-screen-label="OS5 Announcement banner" className="fb-orgban fb-orgban--announce">
          <Info size={16} aria-hidden="true" />
          <span className="fb-orgban__text">
            <strong>{DEMO_ANNOUNCEMENT.title}</strong> {DEMO_ANNOUNCEMENT.body}
          </span>
          <DemoBadge />
          <button type="button" aria-label="Dismiss announcement" className="fb-orgban__x" onClick={() => orgSideDemo.dismissAnnouncement()}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {pending && isManagement ? (
        <section data-screen-label="OS2 Support access approval" className="fb-supcard" aria-label="Support access request">
          <span className="fb-supcard__icon" aria-hidden="true">
            <Eye size={20} />
          </span>
          <div className="fb-supcard__body">
            <div className="fb-supcard__title">
              <strong>Figbloom Support asks to view your workspace</strong>
              <span className="fb-supcard__tag">V2</span>
              <DemoBadge />
            </div>
            <div className="fb-supcard__reason">{pending.reason}</div>
            <div className="fb-supcard__meta">
              {pending.scope} · {pending.mins} minutes · customer values masked · ticket {pending.ticket} · request expires {pending.expires}
            </div>
          </div>
          <div className="fb-supcard__actions">
            <Button
              onClick={() => {
                orgSideDemo.denySupport(pending.id);
                toast.show({ message: "Request denied. Figbloom Support has been told." });
              }}
            >
              Deny
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                orgSideDemo.approveSupport(pending.id);
                toast.show({ message: `Approved for ${pending.mins} minutes. You can end it at any time from the banner.`, tone: "success" });
              }}
            >
              Approve
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
