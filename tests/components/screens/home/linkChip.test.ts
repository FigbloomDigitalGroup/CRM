import { describe, expect, it } from "vitest";
import { linkChipLabel } from "../../../../src/ui/screens/home/dash";

describe("linkChipLabel", () => {
  it("writes the kind and the name, and leaves a label that already has both", () => {
    expect(linkChipLabel({ type: "LEAD", label: "Acme" })).toBe("Lead · Acme");
    expect(linkChipLabel({ type: "deal", label: "Deal · Acme" })).toBe("Deal · Acme");
  });

  it("does not crash when the person's role cannot see the linked record and the label comes back empty", () => {
    expect(linkChipLabel({ type: "deal", label: null })).toBe("Deal");
    expect(linkChipLabel({ type: "deal", label: "" })).toBe("Deal");
    expect(linkChipLabel({ type: null, label: undefined })).toBe("Linked record");
    expect(linkChipLabel({ type: "other", label: null })).toBe("Linked record");
  });
});
