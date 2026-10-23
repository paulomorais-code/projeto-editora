import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../../lib/admin-auth.js";
import { AppError } from "../../lib/errors.js";
import { decryptEmail } from "../../lib/security.js";
import { cancelAndRestock } from "../orders/order.service.js";
import { saveCover, deleteCoverFile, coverMimeToKind } from "../../lib/covers.js";

const stockSchema = z.object({ stock: z.number().int().min(0).max(100000) });
const priceSchema = z.object({ priceCents: z.number().int().min(1).max(100000000) });
const productSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  title: z.string().trim().min(1).max(180),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(5000),
  priceCents: z.number().int().min(1).max(100000000),
  weightGrams: z.number().int().min(1).max(30000).optional(),
  stock: z.number().int().min(0).max(100000),
});
const productUpdateSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  priceCents: z.number().int().min(1).max(100000000).optional(),
  weightGrams: z.number().int().min(1).max(30000).optional(),
  stock: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});
const orderStatusSchema = z.object({
  status: z.enum(["PENDING", "PAID", "PACKING", "SHIPPED", "DELIVERED", "CANCELLED"]),
});
const trackingSchema = z.object({ trackingCode: z.string().trim().min(4).max(60) });
const idSchema = z.object({ id: z.string().cuid() });

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin", async (_, reply) => reply.redirect("/admin/admin.html"));
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/products", async () => ({
    products: await prisma.product.findMany({ orderBy: { title: "asc" } }).then((products) =>
      products.map(({ coverFile, coverMime, ...product }) => ({
        ...product,
        hasCover: Boolean(coverFile),
        coverKind: coverMimeToKind(coverMime),
      })),
    ),
  }));

  app.post("/admin/products", async (request, reply) => {
    const body = productSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_PRODUCT" });
    try {
      const product = await prisma.product.create({
        data: { ...body.data, weightGrams: body.data.weightGrams ?? 300 },
      });
      request.log.info(
        { event: "admin_action", action: "product.create", productId: product.id },
        "Admin created product",
      );
      return reply.code(201).send({ product });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unique constraint"))
        return reply.code(409).send({ error: "PRODUCT_SLUG_EXISTS" });
      throw error;
    }
  });

  // Edição parcial de produto (título, categoria, descrição, preço, peso, estoque, ativo)
  app.patch("/admin/products/:id", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = productUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "INVALID_PRODUCT_UPDATE" });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "INVALID_PRODUCT_UPDATE" });
    try {
      const product = await prisma.product.update({ where: { id: id.data.id }, data: body.data });
      request.log.info(
        {
          event: "admin_action",
          action: "product.update",
          productId: product.id,
          fields: Object.keys(body.data),
        },
        "Admin updated product",
      );
      return { product };
    } catch {
      throw new AppError("PRODUCT_NOT_FOUND", 404);
    }
  });

  // Upload de capa: PNG/JPEG/WebP (imagem) ou PDF. Validação por magic bytes,
  // nome gerado pelo servidor, limite de 10 MB.
  app.post("/admin/products/:id/cover", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    if (!id.success) return reply.code(400).send({ error: "INVALID_PRODUCT_ID" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "COVER_FILE_REQUIRED" });
    const buffer = await file.toBuffer();
    const product = await prisma.product.findUnique({
      where: { id: id.data.id },
      select: { id: true, coverFile: true },
    });
    if (!product) return reply.code(404).send({ error: "PRODUCT_NOT_FOUND" });
    const saved = saveCover(product.id, buffer, product.coverFile);
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { coverFile: saved.file, coverMime: saved.mime },
    });
    request.log.info(
      {
        event: "admin_action",
        action: "product.cover",
        productId: product.id,
        coverKind: coverMimeToKind(saved.mime),
      },
      "Admin uploaded cover",
    );
    return reply
      .code(200)
      .send({ product: { id: updated.id, hasCover: true, coverKind: coverMimeToKind(saved.mime) } });
  });

  app.delete("/admin/products/:id/cover", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    if (!id.success) return reply.code(400).send({ error: "INVALID_PRODUCT_ID" });
    const product = await prisma.product.findUnique({
      where: { id: id.data.id },
      select: { id: true, coverFile: true },
    });
    if (!product) return reply.code(404).send({ error: "PRODUCT_NOT_FOUND" });
    deleteCoverFile(product.coverFile);
    await prisma.product.update({ where: { id: product.id }, data: { coverFile: null, coverMime: null } });
    request.log.info(
      { event: "admin_action", action: "product.cover_remove", productId: product.id },
      "Admin removed cover",
    );
    return { product: { id: product.id, hasCover: false, coverKind: null } };
  });

  app.patch("/admin/products/:id/stock", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = stockSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "INVALID_STOCK_UPDATE" });
    try {
      const product = await prisma.product.update({
        where: { id: id.data.id },
        data: { stock: body.data.stock },
      });
      request.log.info(
        { event: "admin_action", action: "product.stock", productId: product.id },
        "Admin updated stock",
      );
      return { product };
    } catch {
      throw new AppError("PRODUCT_NOT_FOUND", 404);
    }
  });

  app.patch("/admin/products/:id/price", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = priceSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "INVALID_PRICE_UPDATE" });
    try {
      const product = await prisma.product.update({
        where: { id: id.data.id },
        data: { priceCents: body.data.priceCents },
      });
      request.log.info(
        { event: "admin_action", action: "product.price", productId: product.id },
        "Admin updated price",
      );
      return { product };
    } catch {
      throw new AppError("PRODUCT_NOT_FOUND", 404);
    }
  });

  app.get("/admin/orders", async () => ({
    orders: await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
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
    }),
  }));

  // Fulfillment (F-10): único ponto que expõe o endereço de entrega, autenticado e auditado.
  app.get("/admin/orders/:id/address", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    if (!id.success) return reply.code(400).send({ error: "INVALID_ORDER_ID" });
    const order = await prisma.order.findUnique({
      where: { id: id.data.id },
      select: { id: true, shippingAddress: true },
    });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    request.log.info(
      { event: "admin_action", action: "order.address_read", orderId: order.id },
      "Admin read shipping address",
    );
    return { orderId: order.id, shippingAddress: order.shippingAddress };
  });

  // Contato do comprador: e-mail é armazenado criptografado (LGPD) e só sai daqui, com auditoria.
  app.get("/admin/orders/:id/contact", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    if (!id.success) return reply.code(400).send({ error: "INVALID_ORDER_ID" });
    const order = await prisma.order.findUnique({
      where: { id: id.data.id },
      select: { id: true, customerEmailEnc: true },
    });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    const email = decryptEmail(order.customerEmailEnc);
    request.log.info(
      { event: "admin_action", action: "order.contact_read", orderId: order.id },
      "Admin read buyer contact",
    );
    return { orderId: order.id, email };
  });

  // Código de rastreio informado pelo editor após o envio
  app.patch("/admin/orders/:id/tracking", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = trackingSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "INVALID_TRACKING" });
    try {
      const order = await prisma.order.update({
        where: { id: id.data.id },
        data: { trackingCode: body.data.trackingCode },
      });
      request.log.info(
        {
          event: "admin_action",
          action: "order.tracking",
          orderId: order.id,
          trackingCode: body.data.trackingCode,
        },
        "Admin set tracking code",
      );
      return { order: { id: order.id, trackingCode: order.trackingCode, status: order.status } };
    } catch {
      throw new AppError("ORDER_NOT_FOUND", 404);
    }
  });

  app.patch("/admin/orders/:id/status", async (request, reply) => {
    const id = idSchema.safeParse(request.params);
    const body = orderStatusSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "INVALID_ORDER_STATUS" });
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id: id.data.id },
        select: { status: true, paymentStatus: true },
      });
      if (!current) throw new AppError("ORDER_NOT_FOUND", 404);
      if (
        body.data.status === "CANCELLED" &&
        current.status === "PENDING" &&
        current.paymentStatus === "PENDING"
      ) {
        // Cancelamento de pedido não pago: devolve o estoque reservado (mesma regra do job de expiração).
        await cancelAndRestock(tx, id.data.id);
      } else if (body.data.status !== current.status) {
        await tx.order.updateMany({
          where: { id: id.data.id, status: current.status },
          data: { status: body.data.status },
        });
      }
      return tx.order.findUnique({
        where: { id: id.data.id },
        select: { id: true, status: true, paymentStatus: true, totalCents: true, trackingCode: true },
      });
    });
    if (!order) throw new AppError("ORDER_NOT_FOUND", 404);
    request.log.info(
      { event: "admin_action", action: "order.status", orderId: order.id, newStatus: body.data.status },
      "Admin updated order status",
    );
    return { order };
  });
}
