/**
 * The only job types that may run for an organisation the platform is
 * offboarding (B6.05, B6.09): packaging its export. Every other job waits, and a
 * suspended or offboarded organisation runs none (`claimJob` enforces it).
 */
export const ORG_EXPORT_JOB = "platform.org_export";
export const OFFBOARDING_JOB_TYPES: string[] = [ORG_EXPORT_JOB];
