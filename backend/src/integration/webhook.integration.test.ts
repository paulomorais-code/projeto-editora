import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

// O webhook reconsulta o pagamento no Mercado Pago; o teste substitui essa consulta.
const mpLookup = vi.hoisted(() => ({ payment: null as Record<string, unknown> | null }));
vi.mock("../modules/payments/mercadopago.service.js", async () => {
  const { AppError } = await import("../lib/errors.js");
  return {
    createMercadoPagoPreference: vi.fn(),
    getMercadoPagoPayment: vi.fn(async () => {
      if (!mpLookup.payment) throw new AppError("PAYMENT_PROVIDER_ERROR", 502);
      return mpLookup.payment;
    }),
  };
});

const SLUG = "itest-webhook-produto";
const WEBHOOK_SECRET = env.MERCADOPAGO_WEBHOOK_SECRET as string;

let app: FastifyInstance;
let orderId: string;

function assinatura(dataId: string, requestId: string, ts: string): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
}

function webhook(dataId: string, options: { requestId?: string; ts?: string; assinar?: boolean } = {}) {
  const requestId = options.requestId ?? "req-teste";
  const ts = options.ts ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.assinar !== false) headers["x-signature"] = `ts=${ts},v1=${assinatura(dataId, requestId, ts)}`;
  headers["x-request-id"] = requestId;
  return app.inject({
    method: "POST",
    url: `/api/payments/mercadopago/webhook?data.id=${dataId}`,
    headers,
    payload: {},
  });
}

beforeAll(async () => {
  // Execuções anteriores deixam eventos (orderId vira SetNull no delete do pedido): limpar antes.
  await prisma.paymentEvent.deleteMany({
    where: { providerEventId: { in: ["9001", "9002", "9003", "9004"] } },
  });
  app = buildApp();
  await app.ready();
  await prisma.product.upsert({
    where: { slug: SLUG },
    update: { stock: 5, active: true, priceCents: 2000 },
    create: {
      slug: SLUG,
      title: "Produto Webhook",
      category: "Teste",
      description: "teste",
      priceCents: 2000,
      stock: 5,
    },
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/orders",
    payload: {
      email: "webhook@itest.com",
      items: [{ slug: SLUG, quantity: 1 }],
      shippingAddress: {
        name: "Comprador W",
        postalCode: "74000-000",
        street: "Rua do Webhook",
        number: "1",
        neighborhood: "Centro",
        city: "Goiânia",
        state: "GO",
      },
    },
  });
  orderId = created.json().order.id;
});

afterAll(async () => {
  // Eventos de teste persistem após o delete do pedido (orderId → SetNull): limpar antes dos produtos.
  await prisma.paymentEvent.deleteMany({
    where: { providerEventId: { in: ["9001", "9002", "9003", "9004"] } },
  });
  await prisma.order.deleteMany({ where: { items: { some: { product: { slug: SLUG } } } } });
  await prisma.product.deleteMany({ where: { slug: SLUG } });
  await app.close();
});

describe("POST /api/payments/mercadopago/webhook", () => {
  it("assinatura inválida → 401", async () => {
    const response = await webhook("111", { assinar: false });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("INVALID_WEBHOOK");
  });

  it("dataId não numérico → 400", async () => {
    const response = await webhook("abc");
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_WEBHOOK");
  });

  it("pagamento aprovado → pedido PAID/APPROVED", async () => {
    mpLookup.payment = { id: 9001, status: "approved", external_reference: orderId };
    const response = await webhook("9001");
    expect(response.statusCode).toBe(202);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paymentStatus).toBe("APPROVED");
  });

  it("evento duplicado → 202 sem efeito adicional (idempotência)", async () => {
    const before = await prisma.paymentEvent.count({
      where: { provider: "mercadopago", providerEventId: "9001" },
    });
    const response = await webhook("9001", { requestId: "req-replay" });
    expect(response.statusCode).toBe(202);
    const after = await prisma.paymentEvent.count({
      where: { provider: "mercadopago", providerEventId: "9001" },
    });
    expect(after).toBe(before); // constraint única impediu segundo evento
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("APPROVED");
  });

  it("evento pending tardio NÃO regredi o pagamento (F-11)", async () => {
    mpLookup.payment = { id: 9002, status: "pending", external_reference: orderId };
    const response = await webhook("9002");
    expect(response.statusCode).toBe(202);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("APPROVED"); // continua aprovado
    expect(order.status).toBe("PAID");
  });

  it("pagamento rejeitado reflete o provedor", async () => {
    mpLookup.payment = { id: 9003, status: "rejected", external_reference: orderId };
    const response = await webhook("9003");
    expect(response.statusCode).toBe(202);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("REJECTED");
  });

  it("external_reference desconhecido → 202 sem quebrar", async () => {
    mpLookup.payment = { id: 9004, status: "approved", external_reference: "cuid-inexistente-000000" };
    const response = await webhook("9004");
    expect(response.statusCode).toBe(202);
  });
});
