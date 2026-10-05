import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "../src/auth/errors";
import { parseJsonBody, parseQueryParams, requiredString } from "../src/app/api/_lib/validation";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function malformedJsonRequest() {
  return new Request("http://localhost/test", {
    method: "POST",
    body: "{not json",
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseJsonBody", () => {
  const schema = z.object({
    name: z.string().min(1, "name is required."),
    age: z.number().int().optional(),
  });

  it("returns the parsed, typed body on success", async () => {
    const result = await parseJsonBody(jsonRequest({ name: "Jane", age: 30 }), schema);
    expect(result).toEqual({ name: "Jane", age: 30 });
  });

  it("strips unknown fields rather than rejecting them", async () => {
    const result = await parseJsonBody(
      jsonRequest({ name: "Jane", extra: "ignored" }),
      schema,
    );
    expect(result).toEqual({ name: "Jane" });
  });

  it("throws ValidationError with the field's own message for a single issue", async () => {
    await expect(parseJsonBody(jsonRequest({ name: "" }), schema)).rejects.toThrow(
      ValidationError,
    );
    try {
      await parseJsonBody(jsonRequest({ name: "" }), schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationError = err as ValidationError;
      expect(validationError.message).toBe("name is required.");
      expect(validationError.issues).toEqual([
        { path: "name", message: "name is required." },
      ]);
    }
  });

  it("throws a generic message with a full issues array for multiple problems", async () => {
    const multiFieldSchema = z.object({
      name: z.string().min(1, "name is required."),
      email: z.string().email("email must be a valid email address."),
    });
    try {
      await parseJsonBody(jsonRequest({ name: "", email: "not-an-email" }), multiFieldSchema);
      expect.unreachable();
    } catch (err) {
      const validationError = err as ValidationError;
      expect(validationError.message).toBe("Validation failed.");
      expect(validationError.issues).toHaveLength(2);
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          { path: "name", message: "name is required." },
          { path: "email", message: "email must be a valid email address." },
        ]),
      );
    }
  });

  it("reports a nested field's path dot-joined", async () => {
    const nestedSchema = z.object({
      newCompany: z.object({ name: z.string().min(1, "newCompany.name is required.") }),
    });
    try {
      await parseJsonBody(jsonRequest({ newCompany: { name: "" } }), nestedSchema);
      expect.unreachable();
    } catch (err) {
      const validationError = err as ValidationError;
      expect(validationError.issues).toEqual([
        { path: "newCompany.name", message: "newCompany.name is required." },
      ]);
    }
  });

  it("throws ValidationError (not a raw SyntaxError) for malformed JSON", async () => {
    await expect(parseJsonBody(malformedJsonRequest(), schema)).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("parseQueryParams", () => {
  const schema = z.object({
    status: z.enum(["PENDING", "DONE"]).optional(),
  });

  it("parses present query params against the schema", () => {
    const params = new URLSearchParams({ status: "DONE" });
    expect(parseQueryParams(params, schema)).toEqual({ status: "DONE" });
  });

  it("allows an absent optional param", () => {
    const params = new URLSearchParams();
    expect(parseQueryParams(params, schema)).toEqual({});
  });

  it("rejects a value outside the enum", () => {
    const params = new URLSearchParams({ status: "BOGUS" });
    expect(() => parseQueryParams(params, schema)).toThrow(ValidationError);
  });
});

describe("requiredString", () => {
  const schema = z.object({ name: requiredString("name is required.") });

  it("accepts a non-blank string", () => {
    expect(schema.parse({ name: "Acme" })).toEqual({ name: "Acme" });
  });

  it("uses the given message when the field is missing entirely", async () => {
    try {
      await parseJsonBody(jsonRequest({}), schema);
      expect.unreachable();
    } catch (err) {
      const validationError = err as ValidationError;
      // Plain z.string().min(1, msg) only customizes this for an empty
      // string present -- a wholly missing field hits zod's own generic
      // "expected string, received undefined" first. requiredString's
      // whole point is covering both with the same message.
      expect(validationError.message).toBe("name is required.");
    }
  });

  it("uses the given message when the field is an empty string", async () => {
    try {
      await parseJsonBody(jsonRequest({ name: "" }), schema);
      expect.unreachable();
    } catch (err) {
      expect((err as ValidationError).message).toBe("name is required.");
    }
  });
});
