import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { anonymizeOldOrders, cancelExpiredOrders } from "../lib/order-expiry.js";
import { prisma } from "../lib/prisma.js";

const SLUG = "itest-expira-produto";
const stubLog: FastifyBaseLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => stubLog,
  level: "silent",
} as unknown as FastifyBaseLogger;

async function criarPedido(
  diasAtras: number,
  status: "PENDING" | "PAID" | "DELIVERED" | "CANCELLED",
  paymentStatus: "PENDING" | "APPROVED",
  marker: string,
) {
  const created = await prisma.order.create({
    data: {
      status,
      paymentStatus,
      totalCents: 1000,
      customerEmailHash: `hash-${marker}`,
      customerEmailEnc: null,
      shippingAddress: {
        name: marker,
        postalCode: "00000-000",
        street: "Rua",
        number: "1",
        neighborhood: "Centro",
        city: "Cidade",
        state: "GO",
      },
      createdAt: new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000),
      items: {
        create: [
          {
            productId: (
              await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })
            ).id,
            title: SLUG,
            unitCents: 1000,
            quantity: 1,
          },
        ],
      },
    },
    select: { id: true },
  });
  return created.id;
}

beforeAll(async () => {
  await prisma.product.upsert({
    where: { slug: SLUG },
    update: { stock: 10, active: true },
    create: {
      slug: SLUG,
      title: "Expira Teste",
      category: "Teste",
      description: "teste",
      priceCents: 1000,
      stock: 10,
    },
  });
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { items: { some: { product: { slug: SLUG } } } } });
  await prisma.product.deleteMany({ where: { slug: SLUG } });
});

describe("expiração de pedidos (F-05)", () => {
  it("cancela PENDING antigo e devolve o estoque", async () => {
    const before = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stock: true } });
    const id = await criarPedido(2, "PENDING", "PENDING", "expira");
    const cancelled = await cancelExpiredOrders(24, stubLog);
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe("CANCELLED");
    const after = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stock: true } });
    expect(after.stock).toBe(before.stock + 1); // estoque devolvido
  });

  it("não cancela pedido recente", async () => {
    const id = await criarPedido(0, "PENDING", "PENDING", "recente");
    await cancelExpiredOrders(24, stubLog);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe("PENDING");
  });

  it("guard de corrida: PENDING com pagamento APPROVED não é cancelado nem repõe estoque", async () => {
    const before = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stock: true } });
    const id = await criarPedido(2, "PENDING", "APPROVED", "pago");
    await cancelExpiredOrders(24, stubLog);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe("PENDING"); // permanece (webhook venceu a corrida)
    const after = await prisma.product.findUniqueOrThrow({ where: { slug: SLUG }, select: { stock: true } });
    expect(after.stock).toBe(before.stock);
  });
});

describe("retenção LGPD", () => {
  it("anonimiza PII de pedido DELIVERED antigo", async () => {
    const id = await criarPedido(0, "DELIVERED", "APPROVED", "retencao");
    await prisma.order.update({
      where: { id },
      data: {
        updatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        customerEmailHash: "hash-antigo",
        customerEmailEnc: "blob",
      },
    });
    const count = await anonymizeOldOrders(180, stubLog);
    expect(count).toBeGreaterThanOrEqual(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.customerEmailHash).toBe("removido-lgpd");
    expect(order.customerEmailEnc).toBeNull();
    expect(order.shippingAddress).toEqual({ anonimizado: true });
  });

  it("não anonimiza pedido dentro da janela de retenção", async () => {
    const id = await criarPedido(0, "CANCELLED", "PENDING", "janela");
    await anonymizeOldOrders(180, stubLog);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.customerEmailHash).not.toBe("removido-lgpd");
  });

  it("dias = 0 desliga a rotina", async () => {
    const id = await criarPedido(0, "CANCELLED", "PENDING", "desligada");
    await prisma.order.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
    });
    const count = await anonymizeOldOrders(0, stubLog);
    expect(count).toBe(0);
  });
});
