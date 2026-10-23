import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { calculateShipping, quoteOptionsSchema } from "./shipping.service.js";
import { signQuoteToken } from "../../lib/security.js";

const QUOTE_TTL_MS = 30 * 60 * 1000; // cotação vale 30 minutos

export async function shippingRoutes(app: FastifyInstance) {
  app.post("/shipping/quote", async (request, reply) => {
    const parsed = z
      .object({
        postalCode: z.string().regex(/^\d{5}-?\d{3}$/),
        weightGrams: z.number().int().positive().max(30000),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SHIPPING_REQUEST" });
    const options = await calculateShipping(parsed.data.postalCode, parsed.data.weightGrams);
    // Token assinado: o pedido confia nele sem reconsultar o provedor (frete não é ditado pelo cliente).
    const normalized = parsed.data.postalCode.replace(/\D/g, "");
    const quoteToken = signQuoteToken({
      p: normalized,
      w: parsed.data.weightGrams,
      e: Date.now() + QUOTE_TTL_MS,
      o: options,
    });
    return { options, quoteToken, expiresAt: Date.now() + QUOTE_TTL_MS };
  });
}

// Exportado para testes referenciarem o mesmo contrato
export { quoteOptionsSchema };
