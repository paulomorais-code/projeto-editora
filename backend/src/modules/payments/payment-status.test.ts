import { describe, expect, it } from "vitest";
import { nextPaymentStatus } from "./payment-status.js";

describe("nextPaymentStatus", () => {
  it("advances pending to approved or rejected", () => {
    expect(nextPaymentStatus("PENDING", "approved")).toBe("APPROVED");
    expect(nextPaymentStatus("PENDING", "rejected")).toBe("REJECTED");
    expect(nextPaymentStatus("PENDING", "other")).toBe("PENDING");
  });
  it("never regresses from approved to pending (late events, F-11)", () => {
    expect(nextPaymentStatus("APPROVED", "other")).toBe("APPROVED");
    // Rejeição após aprovação reflete o provedor (ex.: pagamento cancelado) e não é regressão.
    expect(nextPaymentStatus("APPROVED", "rejected")).toBe("REJECTED");
  });
  it("rejected can still become approved (retry paid)", () => {
    expect(nextPaymentStatus("REJECTED", "approved")).toBe("APPROVED");
    expect(nextPaymentStatus("REJECTED", "other")).toBe("REJECTED");
  });
  it("refund is terminal", () => {
    expect(nextPaymentStatus("REFUNDED", "approved")).toBe("REFUNDED");
    expect(nextPaymentStatus("REFUNDED", "rejected")).toBe("REFUNDED");
    expect(nextPaymentStatus("REFUNDED", "other")).toBe("REFUNDED");
  });
});
