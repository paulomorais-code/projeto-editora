import type { FastifyInstance } from "fastify";
import { createOrderSchema, orderParamsSchema, extractOrderToken } from "./order.schemas.js";
import { createOrder, getOrder, getOrderForPayment } from "./order.service.js";
import { signOrderId, verifyOrderToken } from "../../lib/security.js";
import { createMercadoPagoPreference } from "../payments/mercadopago.service.js";

const ORDER_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } } as const;

function requireOrderToken(
  request: { headers: Record<string, unknown>; query: unknown },
  orderId: string,
): boolean {
  const token = extractOrderToken(request);
  return token !== null && verifyOrderToken(orderId, token);
}

export async function orderRoutes(app: FastifyInstance) {
  app.post("/orders", ORDER_RATE_LIMIT, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "INVALID_ORDER", details: parsed.error.flatten() });
    const order = await createOrder(parsed.data);
    // Token de acesso devolvido uma única vez ao comprador (prova de posse nas próximas chamadas).
    return reply.code(201).send({ order: { ...order, accessToken: signOrderId(order.id) } });
  });

  app.get("/orders/:id", async (request, reply) => {
    const parsed = orderParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_ORDER_ID" });
    if (!requireOrderToken(request, parsed.data.id)) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const order = await getOrder(parsed.data.id);
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    return { order };
  });

  app.post("/orders/:id/payment-preference", { ...ORDER_RATE_LIMIT }, async (request, reply) => {
    const parsed = orderParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_ORDER_ID" });
    if (!requireOrderToken(request, parsed.data.id)) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const order = await getOrderForPayment(parsed.data.id);
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (order.paymentStatus !== "PENDING") return reply.code(409).send({ error: "ORDER_NOT_PAYABLE" });
    const preference = await createMercadoPagoPreference(order, signOrderId(order.id));
    return { preferenceId: preference.id, checkoutUrl: preference.init_point };
  });
}
