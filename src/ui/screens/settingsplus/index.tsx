"use client";

import { ApprovalRulesEditor } from "./ApprovalRules";
import { CatalogueEditor } from "./Catalogue";
import { PipelinesEditor } from "./Pipelines";
import { SequencesEditor } from "./Sequences";
import { WebFormsEditor } from "./WebForms";

// Roles & field access and Developers (FIG-1194) are V2: their editors stay in this folder, on demo data, and no screen links to them.
export const CatalogueSection = () => <CatalogueEditor />;
export const PipelinesSection = () => <PipelinesEditor />;
export const SequencesSection = () => <SequencesEditor />;
export const WebFormsSection = () => <WebFormsEditor />;
export const ApprovalRulesSection = () => <ApprovalRulesEditor />;
