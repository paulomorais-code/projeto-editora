import { describe, expect, it } from "vitest";
import { createOrderSchema } from "./order.schemas.js";

describe("createOrderSchema", () => {
  it("rejects invalid email and postal code", () => {
    const result = createOrderSchema.safeParse({ email: "invalid", items: [], shippingAddress: {} });
    expect(result.success).toBe(false);
  });
  it("accepts a valid order payload", () => {
    const result = createOrderSchema.safeParse({
      email: "buyer@example.com",
      items: [{ slug: "a-vida-em-goias", quantity: 1 }],
      shippingAddress: {
        name: "Buyer",
        postalCode: "74000-000",
        street: "Rua A",
        number: "1",
        neighborhood: "Centro",
        city: "Goiania",
        state: "GO",
      },
    });
    expect(result.success).toBe(true);
  });
});
