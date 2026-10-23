import { describe, expect, it } from "vitest";
import { hashForLookup, parseBearerToken, signOrderId, verifyOrderToken } from "./security.js";

describe("security helpers", () => {
  it("normalizes lookup hashes", () => {
    expect(hashForLookup("  Buyer@Example.COM ")).toBe(hashForLookup("buyer@example.com"));
  });
  it("parses only bearer tokens", () => {
    expect(parseBearerToken("Bearer secret")).toBe("secret");
    expect(parseBearerToken("Basic secret")).toBeNull();
  });
  it("signs order ids deterministically and verifies valid tokens", () => {
    expect(signOrderId("order-1")).toBe(signOrderId("order-1"));
    expect(signOrderId("order-1")).not.toBe(signOrderId("order-2"));
    expect(verifyOrderToken("order-1", signOrderId("order-1"))).toBe(true);
  });
  it("rejects forged or mismatched order tokens", () => {
    expect(verifyOrderToken("order-1", signOrderId("order-2"))).toBe(false);
    expect(verifyOrderToken("order-1", "tampered-token-value")).toBe(false);
    expect(verifyOrderToken("order-1", "")).toBe(false);
  });
});
