"use client";

import { Building2, ClipboardList, Database, FileText, Globe, History, Inbox, Layers, Lock, RefreshCw, Shield, Tag, Upload, Users, Zap, ListChecks } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { NoAccess } from "../../components/states";
import { useMember } from "../../data/member";
import { AuditLog } from "./AuditLog";
import { Automations } from "./Automations";
import { Integrations } from "./Integrations";
import { InboundEmail, WebsiteIntegration } from "./Website";
import { LifecycleSettings, OnboardingTemplate } from "./Lifecycle";
import { Members } from "./Members";
import { Migration } from "./Migration";
import { OrganisationProfile } from "./OrganisationProfile";
import { DataPrivacy } from "./Privacy";
import { ReferenceData } from "./ReferenceData";
import { SecurityAccess, type MatrixData } from "./Security";
import { CustomFields, MessageTemplates, TagManager } from "./Managers";

interface TabDef {
  id: string;
  label: string;
  icon: ReactNode;
  render: (matrix: MatrixData | null) => ReactNode;
}

const ICON = 16;

/** The Settings sections, in the design's order (design-spec/CrmSystem.dc.html, `tabsDef`). Only the V1 ones; V1.1 and V2 sections arrive with their releases. */
export const SETTINGS_TABS: TabDef[] = [
  { id: "org", label: "Organization profile", icon: <Building2 size={ICON} aria-hidden="true" />, render: () => <OrganisationProfile /> },
  { id: "members", label: "Members", icon: <Users size={ICON} aria-hidden="true" />, render: () => <Members /> },
  { id: "website", label: "Website integration", icon: <Globe size={ICON} aria-hidden="true" />, render: () => <WebsiteIntegration /> },
  { id: "email", label: "Inbound email", icon: <Inbox size={ICON} aria-hidden="true" />, render: () => <InboundEmail /> },
  { id: "ref", label: "Reference data", icon: <Database size={ICON} aria-hidden="true" />, render: () => <ReferenceData /> },
  { id: "lifecycle", label: "Customer lifecycle", icon: <RefreshCw size={ICON} aria-hidden="true" />, render: () => <LifecycleSettings /> },
  { id: "template", label: "Onboarding template", icon: <ClipboardList size={ICON} aria-hidden="true" />, render: () => <OnboardingTemplate /> },
  { id: "automations", label: "Automations", icon: <Zap size={ICON} aria-hidden="true" />, render: () => <Automations /> },
  { id: "integrations", label: "Integrations", icon: <Layers size={ICON} aria-hidden="true" />, render: () => <Integrations /> },
  { id: "templates", label: "Message templates", icon: <FileText size={ICON} aria-hidden="true" />, render: () => <MessageTemplates /> },
  { id: "tags", label: "Tags", icon: <Tag size={ICON} aria-hidden="true" />, render: () => <TagManager /> },
  { id: "fields", label: "Custom fields", icon: <ListChecks size={ICON} aria-hidden="true" />, render: () => <CustomFields /> },
  { id: "migration", label: "Data migration", icon: <Upload size={ICON} aria-hidden="true" />, render: () => <Migration /> },
  { id: "security", label: "Security & access", icon: <Shield size={ICON} aria-hidden="true" />, render: (m) => <SecurityAccess matrix={m} /> },
  { id: "privacy", label: "Data & privacy", icon: <Lock size={ICON} aria-hidden="true" />, render: () => <DataPrivacy /> },
  { id: "audit", label: "Audit log", icon: <History size={ICON} aria-hidden="true" />, render: () => <AuditLog /> },
];

/**
 * Settings (S1 to S9, FIG-1106 to FIG-1111): the left list of sections and the section beside it, chosen by `?tab=`. Only Management reaches it;
 * everyone else gets the explained no-access card with where their own notification choices live. Hiding the sections is not the security
 * boundary: every API route behind them checks `configuration.manage` itself.
 */
export function SettingsScreen({ matrix = null }: { matrix?: MatrixData | null }) {
  const { orgSlug, canAny, roleName } = useMember();
  const search = useSearchParams();
  const allowed = canAny("organization.manage_settings", "configuration.manage");
  const requested = search?.get("tab") ?? "org";
  const tab = SETTINGS_TABS.find((t) => t.id === requested) ?? SETTINGS_TABS[0]!;

  if (!allowed) {
    return (
      <div className="fb-set">
        <div>
          <h1 className="fb-set__title">Settings</h1>
          <p className="fb-set__sub">Organisation settings are managed by Management. You can set how you’re notified.</p>
        </div>
        <h2 className="fb-sr-only">Access</h2>
        <NoAccess area="Settings" denial={{ yourRole: roleName, ownerRoles: ["Management"], whoToAsk: ["Management"] }} />
        <p className="fb-set-muted">
          Your own look, notifications and sign-in history are in <Link href={`/o/${orgSlug}/preferences`}>Preferences</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="fb-set" data-screen-label={`Settings · ${tab.label}`}>
      <h1 className="fb-set__title">Settings</h1>
      <div className="fb-set__grid">
        <nav aria-label="Settings sections" className="fb-set__nav">
          {SETTINGS_TABS.map((t) => (
            <Link key={t.id} href={`/o/${orgSlug}/settings?tab=${t.id}`} className="fb-set__navlink" aria-current={t.id === tab.id ? "page" : undefined} scroll={false}>
              {t.icon}
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="fb-set__body" key={tab.id}>
          {tab.render(matrix)}
        </div>
      </div>
    </div>
  );
}
