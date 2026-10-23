import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { cancelAndRestock } from "../modules/orders/order.service.js";
import { env } from "../config/env.js";

/**
 * Ciclo de vida do pedido (F-05): pedidos PENDING não pagos após ORDER_TTL_HOURS
 * são cancelados e o estoque reservado é devolvido. Roda no processo da API.
 */
export async function cancelExpiredOrders(ttlHours: number, log: FastifyBaseLogger): Promise<number> {
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
  const expired = await prisma.order.findMany({
    where: { status: "PENDING", paymentStatus: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true },
  });
  let cancelled = 0;
  for (const order of expired) {
    try {
      const done = await prisma.$transaction(async (tx) => cancelAndRestock(tx, order.id));
      if (done) cancelled += 1;
    } catch (error) {
      log.warn({ err: error, orderId: order.id }, "order_expiry_failed");
    }
  }
  return cancelled;
}

/**
 * Rotina LGPD: remove PII (endereço, e-mail criptografado e seu hash) de pedidos
 * DELIVERED/CANCELLED mais antigos que RETENTION_DAYS. Preserva o esqueleto financeiro
 * (total, itens, status) para contabilidade. 0 = desligada.
 */
export async function anonymizeOldOrders(retentionDays: number, log: FastifyBaseLogger): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.order.updateMany({
    where: {
      status: { in: ["DELIVERED", "CANCELLED"] },
      updatedAt: { lt: cutoff },
      customerEmailHash: { not: "removido-lgpd" },
    },
    data: {
      shippingAddress: { anonimizado: true },
      customerEmailEnc: null,
      customerEmailHash: "removido-lgpd",
    },
  });
  if (result.count > 0) log.info({ count: result.count }, "retention_anonymized_orders");
  return result.count;
}

export function startOrderExpiryJob(log: FastifyBaseLogger): void {
  const run = async () => {
    try {
      const count = await cancelExpiredOrders(env.ORDER_TTL_HOURS, log);
      if (count > 0) log.info({ count }, "expired_orders_cancelled");
      await anonymizeOldOrders(env.RETENTION_DAYS, log);
    } catch (error) {
      log.error({ err: error }, "order_expiry_job_error");
    }
  };
  const timer = setInterval(() => void run(), 15 * 60 * 1000);
  timer.unref?.();
  void run();
}
