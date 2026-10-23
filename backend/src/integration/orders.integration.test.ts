import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const SLUG_A = "itest-pedido-produto";
const SLUG_LAST = "itest-ultimo-exemplar";
const ADDRESS = {
  name: "Comprador Integração",
  postalCode: "74000-000",
  street: "Rua de Teste",
  number: "1",
  neighborhood: "Centro",
  city: "Goiânia",
  state: "GO",
};

let app: FastifyInstance;

function orderPayload(slug: string, email = "comprador@itest.com") {
  return { email, items: [{ slug, quantity: 1 }], shippingAddress: ADDRESS };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  await prisma.product.upsert({
    where: { slug: SLUG_A },
    update: { stock: 5, active: true, priceCents: 1000 },
    create: {
      slug: SLUG_A,
      title: "Produto Integração",
      category: "Teste",
      description: "produto de teste",
      priceCents: 1000,
      weightGrams: 300,
      stock: 5,
    },
  });
});

afterAll(async () => {
  await prisma.order.deleteMany({
    where: { items: { some: { product: { slug: { in: [SLUG_A, SLUG_LAST] } } } } },
  });
  await prisma.product.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_LAST] } } });
  await app.close();
});

describe("POST /api/orders — reserva concorrente de estoque", () => {
  it("dois pedidos simultâneos pelo último exemplar: um 201, um 409 INSUFFICIENT_STOCK", async () => {
    await prisma.product.upsert({
      where: { slug: SLUG_LAST },
      update: { stock: 1, active: true },
      create: {
        slug: SLUG_LAST,
        title: "Último Exemplar",
        category: "Teste",
        description: "teste",
        priceCents: 500,
        stock: 1,
      },
    });
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/orders", payload: orderPayload(SLUG_LAST, "a@itest.com") }),
      app.inject({ method: "POST", url: "/api/orders", payload: orderPayload(SLUG_LAST, "b@itest.com") }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    expect(JSON.parse(a.statusCode === 201 ? a.body : b.body).error ?? null).toBeNull();
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error).toBe("INSUFFICIENT_STOCK");
    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: SLUG_LAST },
      select: { stock: true },
    });
    expect(product.stock).toBe(0); // exatamente um decremento
  });

  it("recusa quantidade acima do estoque sem tocar o banco", async () => {
    // quantidade 20 = máximo do schema; estoque do produto é 5 → INSUFFICIENT_STOCK (409)
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: { ...orderPayload(SLUG_A), items: [{ slug: SLUG_A, quantity: 20 }] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("INSUFFICIENT_STOCK");
  });
});

describe("GET /api/orders/:id — token de acesso (anti-IDOR)", () => {
  it("sem token 401 · token errado 401 · token correto 200", async () => {
    const created = await app.inject({ method: "POST", url: "/api/orders", payload: orderPayload(SLUG_A) });
    expect(created.statusCode).toBe(201);
    const { order } = created.json();
    expect(order.accessToken).toBeTruthy();

    const semToken = await app.inject({ method: "GET", url: `/api/orders/${order.id}` });
    expect(semToken.statusCode).toBe(401);

    const tokenErrado = await app.inject({
      method: "GET",
      url: `/api/orders/${order.id}`,
      headers: { "x-order-token": "x".repeat(43) },
    });
    expect(tokenErrado.statusCode).toBe(401);

    const comToken = await app.inject({
      method: "GET",
      url: `/api/orders/${order.id}`,
      headers: { "x-order-token": order.accessToken },
    });
    expect(comToken.statusCode).toBe(200);
    expect(comToken.json().order.paymentStatus).toBe("PENDING");
    expect(comToken.json().order.shippingCents).toBe(0); // sem cotação = frete a combinar
    expect(comToken.json().order).not.toHaveProperty("customerEmailHash");
    expect(comToken.json().order).not.toHaveProperty("shippingAddress");
  });

  it("payment-preference com token e MP não configurado → 503 fail-closed", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: orderPayload(SLUG_A, "pref@itest.com"),
    });
    const { order } = created.json();
    const preference = await app.inject({
      method: "POST",
      url: `/api/orders/${order.id}/payment-preference`,
      headers: { "x-order-token": order.accessToken },
    });
    expect(preference.statusCode).toBe(503);
    expect(preference.json().error).toBe("PAYMENT_PROVIDER_NOT_CONFIGURED");
  });
});
