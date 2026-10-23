import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getMercadoPagoPayment } from "./mercadopago.service.js";
import { nextPaymentStatus } from "./payment-status.js";
import type { PaymentStatusValue } from "./payment-status.js";
import { createHash } from "node:crypto";

function isValidMercadoPagoSignature(
  signature: string | undefined,
  requestId: string | undefined,
  dataId: string | undefined,
): boolean {
  if (!env.MERCADOPAGO_WEBHOOK_SECRET || !signature || !requestId || !dataId) return false;
  const timestamp = signature.match(/(?:^|,)ts=([^,]+)/)?.[1];
  const receivedHash = signature.match(/(?:^|,)v1=([^,]+)/)?.[1];
  if (!timestamp || !receivedHash) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const expectedHash = createHmac("sha256", env.MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
  const received = Buffer.from(receivedHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function paymentRoutes(app: FastifyInstance) {
  app.post("/payments/mercadopago/webhook", async (request, reply) => {
    const signature = Array.isArray(request.headers["x-signature"])
      ? request.headers["x-signature"][0]
      : request.headers["x-signature"];
    const requestId = Array.isArray(request.headers["x-request-id"])
      ? request.headers["x-request-id"][0]
      : request.headers["x-request-id"];
    const dataId =
      typeof request.query === "object" && request.query !== null && "data.id" in request.query
        ? String((request.query as Record<string, unknown>)["data.id"])
        : undefined;
    if (!isValidMercadoPagoSignature(signature, requestId, dataId)) {
      return reply.code(401).send({ error: "INVALID_WEBHOOK" });
    }
    // IDs de pagamento do Mercado Pago são numéricos (endurecimento — F-18).
    if (!dataId || !/^\d{1,20}$/.test(dataId)) return reply.code(400).send({ error: "INVALID_WEBHOOK" });
    let payment;
    try {
      payment = await getMercadoPagoPayment(dataId);
    } catch (error) {
      request.log.error({ err: error }, "Mercado Pago payment lookup failed");
      throw new AppError("PAYMENT_PROVIDER_ERROR", 502);
    }
    const orderId = payment.external_reference;
    if (!orderId) return reply.code(202).send({ received: true });
    const approved = payment.status === "approved";
    const rejected = ["rejected", "cancelled"].includes(payment.status ?? "");
    const outcome = approved ? "approved" : rejected ? "rejected" : "other";
    const providerEventId = String(payment.id);
    const payloadHash = createHash("sha256").update(JSON.stringify(payment)).digest("hex");
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, paymentStatus: true, status: true },
      });
      // Pedido inexistente: registra o evento SEM vínculo (orderId null) — não estoura FK nem 500.
      const event = await tx.paymentEvent.createMany({
        data: [{ provider: "mercadopago", providerEventId, payloadHash, orderId: order?.id ?? null }],
        skipDuplicates: true,
      });
      if (event.count === 0) return;
      if (!order) {
        request.log.warn({ event: "webhook_unknown_order", orderId }, "Webhook referenced unknown order");
        return;
      }
      const paymentStatus = nextPaymentStatus(order.paymentStatus as PaymentStatusValue, outcome);
      // Pedido cancelado não volta a "PAID": o valor recebido fica registrado para reembolso manual.
      const status = approved && order.status !== "CANCELLED" ? "PAID" : undefined;
      await tx.order.update({
        where: { id: orderId },
        data: { paymentProviderId: providerEventId, paymentStatus, status },
      });
    });
    request.log.info({ event: "mercadopago_webhook_received" }, "Payment webhook received");
    return reply.code(202).send({ received: true });
  });
}
