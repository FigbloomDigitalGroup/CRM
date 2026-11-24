/**
 * Demo data for the role dashboards' Social snapshot (design CrmDashboard / CrmSocial). Nothing here is real and no network is called.
 * Wiring to the social connectors (S2, S3) replaces this module; search for `demo/` to find what is left. The quote widgets read the quotes
 * demo store (`../../commercial/demo/store.ts`) until quotes are wired; the invoice widgets read the real invoices API.
 */
export interface SocialSnapshot {
  followers: number;
  followersDelta: number;
  mentionsToReply: number;
  channels: number;
}

export const socialSnapshot: SocialSnapshot = { followers: 32140, followersDelta: 987, mentionsToReply: 3, channels: 4 };
