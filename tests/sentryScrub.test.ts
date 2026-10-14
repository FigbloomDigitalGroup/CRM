import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";
import { scrubPII, scrubSentryEvent } from "../src/lib/sentryScrub";

describe("scrubPII", () => {
  it("redacts an email address embedded in free text", () => {
    expect(scrubPII("contact jane@example.com about the deal")).toBe(
      "contact [redacted-email] about the deal",
    );
  });

  it("redacts a phone number embedded in free text", () => {
    expect(scrubPII("call +254 700 123 456 tomorrow")).toBe("call [redacted-phone] tomorrow");
  });

  it("redacts a sensitive key outright regardless of value shape", () => {
    expect(scrubPII({ email: "jane@example.com", value: 150000, name: "Jane" })).toEqual({
      email: "[redacted]",
      value: "[redacted]",
      name: "Jane",
    });
  });

  it("recurses into nested objects and arrays", () => {
    expect(
      scrubPII({
        lead: { contact: { email: "a@b.com", phone: "+254700000000" } },
        deals: [{ value: 5000 }, { value: 9000 }],
      }),
    ).toEqual({
      lead: { contact: { email: "[redacted]", phone: "[redacted]" } },
      deals: [{ value: "[redacted]" }, { value: "[redacted]" }],
    });
  });

  it("is case-insensitive about sensitive key names", () => {
    expect(scrubPII({ Email: "jane@example.com", DealValue: 100 })).toEqual({
      Email: "[redacted]",
      DealValue: "[redacted]",
    });
  });

  it("passes through non-sensitive primitives untouched", () => {
    expect(scrubPII({ count: 3, active: true, id: "abc-123" })).toEqual({
      count: 3,
      active: true,
      id: "abc-123",
    });
  });
});

describe("scrubSentryEvent", () => {
  it("scrubs request data, extra context, tags, and contexts", () => {
    const event = scrubSentryEvent({
      type: undefined,
      request: { data: { email: "jane@example.com", notes: "call +254700000000" } },
      extra: { dealValue: 50000, summary: "reach out to jane@example.com" },
      tags: { ownerEmail: "jane@example.com" },
      contexts: { lead: { phone: "+254700000000" } },
    } as ErrorEvent);

    expect(event.request).toEqual({ data: { email: "[redacted]", notes: "[redacted]" } });
    expect(event.extra).toEqual({
      dealValue: "[redacted]",
      summary: "reach out to [redacted-email]",
    });
    // "ownerEmail" isn't an exact match in the sensitive-key set, so this
    // is caught by the pattern-based email scrub instead of key-redaction
    // -- still fully scrubbed, just via the other layer.
    expect(event.tags).toEqual({ ownerEmail: "[redacted-email]" });
    expect(event.contexts).toEqual({ lead: { phone: "[redacted]" } });
  });

  it("keeps only the user id, dropping anything else (name/email/ip)", () => {
    const event = scrubSentryEvent({
      user: { id: "membership-123", email: "jane@example.com", ip_address: "1.2.3.4" },
    } as ErrorEvent);

    expect(event.user).toEqual({ id: "membership-123" });
  });

  it("drops the user object entirely when it has no id", () => {
    const event = scrubSentryEvent({
      user: { email: "jane@example.com" },
    } as ErrorEvent);

    expect(event.user).toBeUndefined();
  });

  it("scrubs breadcrumb messages and data", () => {
    const event = scrubSentryEvent({
      type: undefined,
      breadcrumbs: [
        { message: "submitted form for jane@example.com", data: { phone: "+254700000000" } },
      ],
    } as ErrorEvent);

    expect(event.breadcrumbs).toEqual([
      { message: "submitted form for [redacted-email]", data: { phone: "[redacted]" } },
    ]);
  });

  it("scrubs the exception message itself", () => {
    const event = scrubSentryEvent({
      exception: { values: [{ type: "Error", value: "Duplicate contact jane@example.com" }] },
    } as ErrorEvent);

    expect(event.exception!.values![0]!.value).toBe("Duplicate contact [redacted-email]");
  });

  it("leaves an event with none of the above untouched", () => {
    const event = scrubSentryEvent({ event_id: "abc", level: "error" } as ErrorEvent);
    expect(event).toEqual({ event_id: "abc", level: "error" });
  });
});
