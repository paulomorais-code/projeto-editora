import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { resetAdminAttempts } from "../lib/admin-auth.js";
import { env } from "../config/env.js";

const SLUG = "itest-admin-produto";
const TOKEN = env.EDITOR_API_TOKEN as string;
const auth = { "x-admin-token": TOKEN, "content-type": "application/json" };

let app: FastifyInstance;
let productId: string;
let orderId: string;

const novoProduto = {
  slug: SLUG,
  title: "Produto Admin",
  category: "Teste",
  description: "criado via integração",
  priceCents: 4500,
  weightGrams: 250,
  stock: 3,
};

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  resetAdminAttempts();
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { items: { some: { product: { slug: SLUG } } } } });
  await prisma.product.deleteMany({ where: { slug: SLUG } });
  await app.close();
});

describe("autenticação do admin", () => {
  it("sem token → 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/products" });
    expect(response.statusCode).toBe(401);
  });

  it("força-bruta: 5 falhas ⇒ 429 mesmo com token correto", async () => {
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: "GET",
        url: "/api/admin/products",
        headers: { "x-admin-token": `errado-${i}` },
      });
    }
    const blocked = await app.inject({ method: "GET", url: "/api/admin/products", headers: auth });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("TOO_MANY_ATTEMPTS");
    resetAdminAttempts(); // limpa para os demais testes (simula reinício/janela expirada)
  });

  it("token correto → 200", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/products", headers: auth });
    expect(response.statusCode).toBe(200);
  });
});

describe("gestão de produtos", () => {
  it("cria, edita parcialmente, desativa e reativa", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/products",
      headers: auth,
      payload: novoProduto,
    });
    expect(created.statusCode).toBe(201);
    productId = created.json().product.id;

    // slug duplicado → 409
    const dup = await app.inject({
      method: "POST",
      url: "/api/admin/products",
      headers: auth,
      payload: novoProduto,
    });
    expect(dup.statusCode).toBe(409);

    // edição parcial (título + desativação)
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/admin/products/${productId}`,
      headers: auth,
      payload: { title: "Produto Admin v2", active: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().product.title).toBe("Produto Admin v2");
    expect(patched.json().product.active).toBe(false);

    // catálogo público não mostra produto inativo
    const catalog = await app.inject({ method: "GET", url: "/api/products" });
    expect(catalog.json().products.find((p: { slug: string }) => p.slug === SLUG)).toBeUndefined();

    // reativa → volta ao catálogo
    await app.inject({
      method: "PATCH",
      url: `/api/admin/products/${productId}`,
      headers: auth,
      payload: { active: true },
    });
    const catalog2 = await app.inject({ method: "GET", url: "/api/products" });
    expect(catalog2.json().products.find((p: { slug: string }) => p.slug === SLUG)).toBeDefined();
  });

  it("PATCH em produto inexistente → 404", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/admin/products/cmtest0000000000admin00",
      headers: auth,
      payload: { active: false },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("fulfillment do pedido", () => {
  beforeAll(async () => {
    // garante produto ativo com estoque e um pedido pago
    await prisma.product.update({ where: { slug: SLUG }, data: { active: true, stock: 3 } });
    const created = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        email: "fulfillment@itest.com",
        items: [{ slug: SLUG, quantity: 1 }],
        shippingAddress: {
          name: "F Teste",
          postalCode: "74000-000",
          street: "Rua F",
          number: "10",
          neighborhood: "Centro",
          city: "Goiânia",
          state: "GO",
        },
      },
    });
    orderId = created.json().order.id;
  });

  it("endereço de entrega acessível e auditado", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/orders/${orderId}/address`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().shippingAddress.name).toBe("F Teste");
  });

  it("contato: e-mail descriptografado corretamente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/orders/${orderId}/contact`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe("fulfillment@itest.com");
  });

  it("rastreio válido é salvo; inválido → 400", async () => {
    const ok = await app.inject({
      method: "PATCH",
      url: `/api/admin/orders/${orderId}/tracking`,
      headers: auth,
      payload: { trackingCode: "BR123456789BR" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().order.trackingCode).toBe("BR123456789BR");

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/admin/orders/${orderId}/tracking`,
      headers: auth,
      payload: { trackingCode: "x" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("cancelar pedido não pago devolve o estoque", async () => {
    const antes = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stock: true } });
    const response = await app.inject({
      method: "PATCH",
      url: `/api/admin/orders/${orderId}/status`,
      headers: auth,
      payload: { status: "CANCELLED" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().order.status).toBe("CANCELLED");
    const depois = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stock: true } });
    expect(depois.stock).toBe(antes.stock + 1);
  });

  it("status em pedido inexistente → 404", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/admin/orders/cmtest0000000000order00/status",
      headers: auth,
      payload: { status: "PAID" },
    });
    expect(response.statusCode).toBe(404);
  });
});
