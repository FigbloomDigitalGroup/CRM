import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, RateLimitedError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { resolveWebsitePublicContext } from "../src/auth/websiteApiKey";
import { adminDb } from "../src/db/adminClient";
import * as integrationService from "../src/services/integrationService";
import { submitWebsiteLead } from "../src/services/websiteLeadService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

async function generateAndSetKey(organizationId: string) {
  const ctx = await createTestContext(organizationId, "MANAGEMENT");
  const { apiKey } = await integrationService.regenerateWebsiteApiKey(ctx);
  return { ctx, apiKey };
}

/** A fresh fake IP per test -- rate limiting is IP-scoped, and the test DB
 * persists across runs, so a literal reused IP would collide the same way
 * a literal reused email did in membershipService.test.ts. */
function uniqueIp(): string {
  return `203.0.113.${randomUUID().slice(0, 2)}.${randomUUID().slice(0, 2)}-${randomUUID().slice(0, 4)}`;
}

function leadBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ name: "Test Lead", email: "lead@example.test", ...overrides });
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("websiteLeadService: rate limiting", () => {
  it("rejects with RateLimitedError once the per-IP limit is exceeded within the window", async () => {
    process.env.WEBSITE_LEAD_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_IP = "3";
    process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_KEY = "1000";

    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);
    const ip = uniqueIp();
    const meta = { ipAddress: ip, origin: null };

    for (let i = 0; i < 3; i++) {
      await submitWebsiteLead(org.slug, apiKey, leadBody(), meta);
    }

    await expect(
      submitWebsiteLead(org.slug, apiKey, leadBody(), meta),
    ).rejects.toThrow(RateLimitedError);
  });

  it("rejects with RateLimitedError once the per-key limit is exceeded, even across different IPs", async () => {
    process.env.WEBSITE_LEAD_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_IP = "1000";
    process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_KEY = "3";

    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    for (let i = 0; i < 3; i++) {
      await submitWebsiteLead(org.slug, apiKey, leadBody(), {
        ipAddress: uniqueIp(),
        origin: null,
      });
    }

    await expect(
      submitWebsiteLead(org.slug, apiKey, leadBody(), {
        ipAddress: uniqueIp(),
        origin: null,
      }),
    ).rejects.toThrow(RateLimitedError);
  });

  it("does not rate-limit a different IP/key pair still under its own limit", async () => {
    process.env.WEBSITE_LEAD_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_IP = "1";
    process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_KEY = "1000";

    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    await submitWebsiteLead(org.slug, apiKey, leadBody(), {
      ipAddress: uniqueIp(),
      origin: null,
    });
    // A different IP, same key, same tiny per-IP limit -- must not inherit
    // the first IP's exhausted count.
    const result = await submitWebsiteLead(org.slug, apiKey, leadBody(), {
      ipAddress: uniqueIp(),
      origin: null,
    });
    expect(result).not.toBeNull();
  });
});

describe("websiteLeadService: payload size and field length limits", () => {
  it("rejects a payload larger than the configured byte cap", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    const hugeMessage = "x".repeat(20_000);
    await expect(
      submitWebsiteLead(
        org.slug,
        apiKey,
        leadBody({ message: hugeMessage }),
        { ipAddress: uniqueIp(), origin: null },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a name field far longer than any real name", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    await expect(
      submitWebsiteLead(
        org.slug,
        apiKey,
        leadBody({ name: "x".repeat(500) }),
        { ipAddress: uniqueIp(), origin: null },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("does not create a lead when validation fails on size/length", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);
    const before = await adminDb.lead.count({ where: { organizationId: org.id } });

    await expect(
      submitWebsiteLead(
        org.slug,
        apiKey,
        leadBody({ name: "x".repeat(500) }),
        { ipAddress: uniqueIp(), origin: null },
      ),
    ).rejects.toThrow();

    const after = await adminDb.lead.count({ where: { organizationId: org.id } });
    expect(after).toBe(before);
  });
});

describe("websiteLeadService: honeypot", () => {
  it("silently discards a submission with the honeypot field filled in -- no error, no lead, but logged", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await integrationService.updateWebsiteApiKeySettings(ctx, {
      honeypotFieldName: "website",
    });

    const before = await adminDb.lead.count({ where: { organizationId: org.id } });
    const result = await submitWebsiteLead(
      org.slug,
      apiKey,
      leadBody({ website: "http://spam.example" }),
      { ipAddress: uniqueIp(), origin: null },
    );
    expect(result).toBeNull();

    const after = await adminDb.lead.count({ where: { organizationId: org.id } });
    expect(after).toBe(before);

    const activity = await integrationService.listRecentWebsiteActivity(ctx, 5);
    expect(activity[0].outcome).toBe("HONEYPOT_TRIGGERED");
  });

  it("accepts a normal submission when the honeypot field is configured but left empty", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await integrationService.updateWebsiteApiKeySettings(ctx, {
      honeypotFieldName: "website",
    });

    const result = await submitWebsiteLead(org.slug, apiKey, leadBody(), {
      ipAddress: uniqueIp(),
      origin: null,
    });
    expect(result).not.toBeNull();
  });
});

describe("websiteLeadService: allowed origins", () => {
  it("rejects a mismatched origin when allowedOrigins is configured", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await integrationService.updateWebsiteApiKeySettings(ctx, {
      allowedOrigins: ["https://figbloom.example"],
    });

    await expect(
      submitWebsiteLead(org.slug, apiKey, leadBody(), {
        ipAddress: uniqueIp(),
        origin: "https://evil.example",
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a missing origin when allowedOrigins is configured", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await integrationService.updateWebsiteApiKeySettings(ctx, {
      allowedOrigins: ["https://figbloom.example"],
    });

    await expect(
      submitWebsiteLead(org.slug, apiKey, leadBody(), {
        ipAddress: uniqueIp(),
        origin: null,
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("accepts a matching origin", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await integrationService.updateWebsiteApiKeySettings(ctx, {
      allowedOrigins: ["https://figbloom.example"],
    });

    const result = await submitWebsiteLead(org.slug, apiKey, leadBody(), {
      ipAddress: uniqueIp(),
      origin: "https://figbloom.example",
    });
    expect(result).not.toBeNull();
  });

  it("accepts any origin (including none) when allowedOrigins is left unconfigured", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    const result = await submitWebsiteLead(org.slug, apiKey, leadBody(), {
      ipAddress: uniqueIp(),
      origin: null,
    });
    expect(result).not.toBeNull();
  });
});

describe("websiteLeadService: captcha (live Cloudflare Turnstile test secrets)", () => {
  // Cloudflare publishes these dummy sitekey/secret pairs specifically for
  // automated testing -- https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  // They are not tied to any real account and are safe to call for real.
  const ALWAYS_PASSES_SECRET = "1x0000000000000000000000000000000AA";
  const ALWAYS_FAILS_SECRET = "2x0000000000000000000000000000000AA";

  it(
    "accepts a submission when the real Turnstile verify call passes",
    async () => {
      const org = await createTestOrganization();
      const { ctx, apiKey } = await generateAndSetKey(org.id);
      await integrationService.updateWebsiteApiKeySettings(ctx, {
        captchaSecret: ALWAYS_PASSES_SECRET,
      });

      const result = await submitWebsiteLead(
        org.slug,
        apiKey,
        leadBody({ captchaToken: "any-token-works-for-this-test-secret" }),
        { ipAddress: uniqueIp(), origin: null },
      );
      expect(result).not.toBeNull();
    },
    15000,
  );

  it(
    "rejects a submission when the real Turnstile verify call fails",
    async () => {
      const org = await createTestOrganization();
      const { ctx, apiKey } = await generateAndSetKey(org.id);
      await integrationService.updateWebsiteApiKeySettings(ctx, {
        captchaSecret: ALWAYS_FAILS_SECRET,
      });

      await expect(
        submitWebsiteLead(
          org.slug,
          apiKey,
          leadBody({ captchaToken: "irrelevant-this-secret-always-fails" }),
          { ipAddress: uniqueIp(), origin: null },
        ),
      ).rejects.toThrow(ValidationError);
    },
    15000,
  );

  it("rejects a submission with a captcha configured but no token provided", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await integrationService.updateWebsiteApiKeySettings(ctx, {
      captchaSecret: ALWAYS_PASSES_SECRET,
    });

    await expect(
      submitWebsiteLead(org.slug, apiKey, leadBody(), {
        ipAddress: uniqueIp(),
        origin: null,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("integrationService: key rotation and revocation", () => {
  it("rotating invalidates the previous key immediately", async () => {
    const org = await createTestOrganization();
    const { apiKey: firstKey } = await generateAndSetKey(org.id);
    await resolveWebsitePublicContext(org.slug, firstKey);

    const { apiKey: secondKey } = await generateAndSetKey(org.id);
    await expect(
      resolveWebsitePublicContext(org.slug, firstKey),
    ).rejects.toThrow(UnauthorizedError);
    const resolved = await resolveWebsitePublicContext(org.slug, secondKey);
    expect(resolved.organizationId).toBe(org.id);
  });

  it("revoking makes the current key stop working without issuing a new one", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);
    await resolveWebsitePublicContext(org.slug, apiKey);

    await integrationService.revokeWebsiteApiKey(ctx);

    await expect(
      resolveWebsitePublicContext(org.slug, apiKey),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("regenerating after a revoke clears the revocation and works again", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey: firstKey } = await generateAndSetKey(org.id);
    await integrationService.revokeWebsiteApiKey(ctx);
    await expect(
      resolveWebsitePublicContext(org.slug, firstKey),
    ).rejects.toThrow(UnauthorizedError);

    const { apiKey: newKey } = await integrationService.regenerateWebsiteApiKey(ctx);
    const resolved = await resolveWebsitePublicContext(org.slug, newKey);
    expect(resolved.organizationId).toBe(org.id);

    const status = await integrationService.getWebsiteIntegrationStatus(ctx);
    expect(status.configured && status.revoked).toBe(false);
  });

  it("requires configuration.manage to revoke", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    await expect(
      integrationService.revokeWebsiteApiKey(salesCtx),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects revoking when no key has ever been generated", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    await expect(integrationService.revokeWebsiteApiKey(ctx)).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("integrationService.listRecentWebsiteActivity: monitoring", () => {
  it("shows both accepted and rejected attempts for the organization", async () => {
    const org = await createTestOrganization();
    const { ctx, apiKey } = await generateAndSetKey(org.id);

    await submitWebsiteLead(org.slug, apiKey, leadBody(), {
      ipAddress: uniqueIp(),
      origin: null,
    });
    await expect(
      submitWebsiteLead(org.slug, "wlk_live_wrongkey", leadBody(), {
        ipAddress: uniqueIp(),
        origin: null,
      }),
    ).rejects.toThrow();

    const activity = await integrationService.listRecentWebsiteActivity(ctx, 10);
    const outcomes = activity.map((a) => a.outcome).sort();
    expect(outcomes).toEqual(["ACCEPTED", "INVALID_KEY"].sort());
  });

  it("never shows another organization's request log (tenant isolation)", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { ctx: ctxA, apiKey: keyA } = await generateAndSetKey(orgA.id);
    const { ctx: ctxB } = await generateAndSetKey(orgB.id);

    await submitWebsiteLead(orgA.slug, keyA, leadBody(), {
      ipAddress: uniqueIp(),
      origin: null,
    });

    const activityB = await integrationService.listRecentWebsiteActivity(ctxB, 10);
    expect(activityB).toHaveLength(0);

    const activityA = await integrationService.listRecentWebsiteActivity(ctxA, 10);
    expect(activityA.length).toBeGreaterThan(0);
  });

  it("requires configuration.manage to view activity", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    await expect(
      integrationService.listRecentWebsiteActivity(salesCtx, 10),
    ).rejects.toThrow(ForbiddenError);
  });
});
