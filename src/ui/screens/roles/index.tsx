"use client";

import { OrgStructure } from "./OrgStructure";
import { RolesAccess } from "./RolesAccess";
import { SalesAccess } from "./SalesAccess";

// Roles & access is on the real roles API. Sales access and Organisation structure run on demo data (src/ui/screens/roles/demo/) until UC-C1 and UC-C3.
export const RolesAccessSection = () => <RolesAccess />;
export const SalesAccessSection = () => <SalesAccess />;
export const OrgStructureSection = () => <OrgStructure />;
