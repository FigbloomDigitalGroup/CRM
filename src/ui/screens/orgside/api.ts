"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMember } from "../../data/member";
import { callUncontracted } from "../../data/client";

/**
 * The data layer of the organisation-side V1.1 screens: the organisation switcher (FIG-1133) and Settings › Two-step sign-in (FIG-1134). Their routes
 * are not in the frozen V1 contract yet, so they go through `callUncontracted`; the organisation policy route is typed.
 */

export interface MyOrganisation {
  slug: string;
  name: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  current: boolean;
}

export function useMyOrganisations() {
  return useQuery({ queryKey: ["me-organizations"], queryFn: () => callUncontracted<{ items: MyOrganisation[]; currentSlug: string | null }>("GET", "/api/me/organizations") });
}

export function useSwitchOrganisation() {
  return useMutation({ mutationFn: (organizationSlug: string) => callUncontracted<unknown>("POST", "/api/me/organizations/switch", { organizationSlug }) });
}

export interface TrustedDevice {
  id: string;
  label: string | null;
  addedAt: string;
  lastUsedAt: string;
  expiresAt: string;
}
export interface MyTwoStep {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
  requiredByOrganisation: boolean;
  trustedDevices: TrustedDevice[];
}

export function useMyTwoStep() {
  return useQuery({ queryKey: ["me-two-step"], queryFn: () => callUncontracted<MyTwoStep>("GET", "/api/me/two-step") });
}

export function useForgetDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => callUncontracted<unknown>("DELETE", `/api/me/trusted-devices/${encodeURIComponent(deviceId)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["me-two-step"] }),
  });
}

export interface TwoStepPolicy {
  required: boolean;
  trustedDeviceDays: number;
  yourTwoStepIsOn: boolean;
}

/** The policy routes are typed without a request body in the frozen contract, so they go through the same uncontracted call. */
export function useTwoStepPolicy() {
  const { orgSlug } = useMember();
  return useQuery({ queryKey: ["two-step-policy", orgSlug], queryFn: () => callUncontracted<TwoStepPolicy>("GET", `/api/orgs/${orgSlug}/security/two-step-policy`) });
}
export function useSetTwoStepPolicy() {
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (required: boolean) => callUncontracted<{ required: boolean; signedOut: number }>("PATCH", `/api/orgs/${orgSlug}/security/two-step-policy`, { required }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["two-step-policy", orgSlug] }),
  });
}
