"use client";

import dynamic from "next/dynamic";
import { OrgStructure } from "./OrgStructure";
import { SalesAccess } from "./SalesAccess";

// Roles & access is on the real roles API. Sales access and Organisation structure run on demo data (src/ui/screens/roles/demo/) until UC-C1 and UC-C3.
// The roles editor is its own chunk, loaded when the tab opens, so the Settings page stays inside the script budget (npm run check:bundle-budget).
const RolesAccess = dynamic(() => import("./RolesAccess").then((m) => m.RolesAccess), { ssr: false });

export const RolesAccessSection = () => <RolesAccess />;
export const SalesAccessSection = () => <SalesAccess />;
export const OrgStructureSection = () => <OrgStructure />;
