"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/ui";
import { demoScreensEnabledClient } from "../../demo/enabled";
import { ApprovalRulesEditor } from "./ApprovalRules";
import { CatalogueEditor } from "./Catalogue";
import { DevelopersEditor } from "./Developers";
import { PipelinesEditor } from "./Pipelines";
import { RolesEditor } from "./Roles";
import { SequencesEditor } from "./Sequences";
import { WebFormsEditor } from "./WebForms";

/** Until an editor is wired to the real API (M13/M14) it renders only where demo screens are allowed (docs/RESTRUCTURE_LOG.md). */
function Demo({ children }: { children: ReactNode }) {
  if (!demoScreensEnabledClient()) return <EmptyState title="Not available yet" body="This section arrives with the next release." />;
  return <>{children}</>;
}

export const CatalogueSection = () => <Demo><CatalogueEditor /></Demo>;
export const PipelinesSection = () => <Demo><PipelinesEditor /></Demo>;
export const SequencesSection = () => <Demo><SequencesEditor /></Demo>;
export const WebFormsSection = () => <Demo><WebFormsEditor /></Demo>;
export const ApprovalRulesSection = () => <Demo><ApprovalRulesEditor /></Demo>;
export const RolesSection = () => <Demo><RolesEditor /></Demo>;
export const DevelopersSection = () => <Demo><DevelopersEditor /></Demo>;
