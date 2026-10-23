import { Payment, Preference } from "mercadopago";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export async function createMercadoPagoPreference(
  order: {
    id: string;
    totalCents: number;
    items: Array<{ title: string; quantity: number; unitCents: number }>;
  },
  orderToken?: string,
) {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) throw new AppError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503);
  const preference = new Preference({ accessToken: env.MERCADOPAGO_ACCESS_TOKEN });
  // Token propagado nas URLs de retorno: o comprador prova posse do pedido ao voltar.
  // Token e ID do pedido vão no fragmento (#): o Mercado Pago anexa os próprios parâmetros
  // de query depois do caminho e o fragmento permanece intacto para as páginas de retorno.
  const suffix = orderToken
    ? `#pedido=${encodeURIComponent(order.id)}&token=${encodeURIComponent(orderToken)}`
    : "";
  return preference.create({
    body: {
      external_reference: order.id,
      items: order.items.map((item) => ({
        id: order.id,
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unitCents / 100,
        currency_id: "BRL",
      })),
      back_urls: {
        success: `${env.FRONTEND_ORIGIN}/pagamento/sucesso${suffix}`,
        failure: `${env.FRONTEND_ORIGIN}/pagamento/falha${suffix}`,
        pending: `${env.FRONTEND_ORIGIN}/pagamento/pendente${suffix}`,
      },
      auto_return: "approved",
    },
  });
}

export async function getMercadoPagoPayment(paymentId: string) {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) throw new AppError("PAYMENT_PROVIDER_NOT_CONFIGURED", 503);
  return new Payment({ accessToken: env.MERCADOPAGO_ACCESS_TOKEN }).get({ id: paymentId });
}
