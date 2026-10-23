import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

/** Contrato esperado do provedor de frete — falha fechado se o formato mudar (F-09). */
export const quoteOptionsSchema = z.object({
  service: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0).max(10000000),
  deadlineDays: z.number().int().min(0).max(120).optional(),
});

const quoteResponseSchema = z.object({ options: z.array(quoteOptionsSchema).min(1) }).passthrough();

export async function calculateShipping(postalCode: string, weightGrams: number) {
  if (!env.CORREIOS_BASE_URL) throw new AppError("SHIPPING_PROVIDER_NOT_CONFIGURED", 503);
  if (!env.CORREIOS_CLIENT_ID || !env.CORREIOS_CLIENT_SECRET)
    throw new AppError("SHIPPING_PROVIDER_NOT_CONFIGURED", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${env.CORREIOS_BASE_URL}/shipping/quote`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${env.CORREIOS_CLIENT_SECRET}` },
      body: JSON.stringify({
        clientId: env.CORREIOS_CLIENT_ID,
        contractNumber: env.CORREIOS_CONTRACT_NUMBER,
        postalCode,
        weightGrams,
      }),
    });
    if (!response.ok) throw new AppError("SHIPPING_PROVIDER_ERROR", 502);
    // Resposta de provedor externo NUNCA é repassada sem validação (F-09).
    const parsed = quoteResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new AppError("SHIPPING_PROVIDER_ERROR", 502);
    return parsed.data.options;
  } finally {
    clearTimeout(timeout);
  }
}
