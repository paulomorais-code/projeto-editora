import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { hashForLookup, encryptEmail, verifyQuoteToken } from "../../lib/security.js";
import { AppError } from "../../lib/errors.js";
import type { z } from "zod";
import type { createOrderSchema } from "./order.schemas.js";

type CreateOrderInput = z.infer<typeof createOrderSchema>;

export async function createOrder(input: CreateOrderInput) {
  // Leitura de produtos, verificação de estoque, baixa e criação do pedido
  // acontecem na MESMA transação (evita preço/estoque obsoleto — F-20).
  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { slug: { in: input.items.map((item) => item.slug) }, active: true },
    });
    const bySlug = new Map(products.map((product) => [product.slug, product]));
    const items = input.items.map((item) => {
      const product = bySlug.get(item.slug);
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", 400);
      if (product.stock < item.quantity) throw new AppError("INSUFFICIENT_STOCK", 409);
      // Preço efetivo: promoção quando existir (LOM-style), senão preço cheio.
      const precoUnitario = product.promoPriceCents ?? product.priceCents;
      return { product, quantity: item.quantity, precoUnitario };
    });

    // Frete: validado contra o token assinado pela cotação (o cliente não dita o preço).
    let shippingCents = 0;
    let shippingMethod: string | null = null;
    if (input.shipping) {
      const totalWeight = items.reduce(
        (weight, item) => weight + item.product.weightGrams * item.quantity,
        0,
      );
      const quote = verifyQuoteToken(input.shipping.quoteToken);
      const postalDigits = input.shippingAddress.postalCode.replace(/\D/g, "");
      if (!quote || quote.p !== postalDigits || quote.w !== totalWeight)
        throw new AppError("QUOTE_INVALID", 400);
      const option = quote.o[input.shipping.optionIndex];
      if (!option) throw new AppError("QUOTE_INVALID", 400);
      shippingCents = option.priceCents;
      shippingMethod = option.service;
    }

    const totalCents =
      items.reduce((total, item) => total + item.product.priceCents * item.quantity, 0) + shippingCents;

    for (const item of items) {
      const updated = await tx.product.updateMany({
        where: { id: item.product.id, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (updated.count !== 1) throw new AppError("INSUFFICIENT_STOCK", 409);
    }

    return tx.order.create({
      data: {
        totalCents,
        shippingCents,
        shippingMethod,
        customerEmailHash: hashForLookup(input.email),
        customerEmailEnc: encryptEmail(input.email),
        shippingAddress: input.shippingAddress,
        items: {
          create: items.map(({ product, quantity, precoUnitario }) => ({
            productId: product.id,
            title: product.title,
            unitCents: precoUnitario,
            quantity,
          })),
        },
      },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalCents: true,
        shippingCents: true,
        shippingMethod: true,
        items: true,
      },
    });
  });
}

export async function getOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      totalCents: true,
      shippingCents: true,
      shippingMethod: true,
      trackingCode: true,
      createdAt: true,
      items: true,
    },
  });
}

export async function getOrderForPayment(id: string) {
  return prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      totalCents: true,
      paymentStatus: true,
      items: { select: { title: true, quantity: true, unitCents: true } },
    },
  });
}

/**
 * Cancela um pedido PENDING não pago e devolve o estoque reservado.
 * Usado pelo job de expiração (TTL) e pelo cancelamento manual do editor.
 * Retorna false se o pedido deixou de ser PENDING/PENDING no meio do caminho (corrida com webhook).
 */
export async function cancelAndRestock(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: "PENDING", paymentStatus: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (updated.count !== 1) return false;
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true },
  });
  for (const item of items) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  }
  return true;
}
