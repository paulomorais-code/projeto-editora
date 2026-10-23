import { z } from "zod";

const itemSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
});

export const createOrderSchema = z.object({
  email: z.string().email().max(254),
  items: z.array(itemSchema).min(1).max(20),
  shippingAddress: z.object({
    name: z.string().min(2).max(120),
    postalCode: z.string().regex(/^\d{5}-?\d{3}$/),
    street: z.string().min(3).max(160),
    number: z.string().min(1).max(20),
    complement: z.string().max(120).optional(),
    neighborhood: z.string().min(2).max(100),
    city: z.string().min(2).max(100),
    state: z.string().regex(/^[A-Za-z]{2}$/),
  }),
  // Frete: token assinado pela rota de cotação. Ausente = "frete a combinar" (custo 0).
  shipping: z
    .object({
      quoteToken: z.string().min(20).max(20000),
      optionIndex: z.number().int().min(0).max(50),
    })
    .optional(),
});

export const orderParamsSchema = z.object({ id: z.string().cuid() });

// Token de acesso enviado por header x-order-token ou ?token= (anti-IDOR, F-06)
export const orderTokenHeaderSchema = z.object({ "x-order-token": z.string().min(1).optional() });
export const orderTokenQuerySchema = z.object({ token: z.string().min(1).optional() });

export function extractOrderToken(request: {
  headers: Record<string, unknown>;
  query: unknown;
}): string | null {
  const header = orderTokenHeaderSchema.safeParse(request.headers);
  const query = orderTokenQuerySchema.safeParse(request.query);
  const fromHeader = header.success ? header.data["x-order-token"] : undefined;
  const fromQuery = query.success ? query.data.token : undefined;
  return fromHeader ?? fromQuery ?? null;
}
