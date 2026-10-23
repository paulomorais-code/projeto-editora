export type PaymentStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED";

/**
 * Transições de status de pagamento (F-11):
 * - NUNCA regride para PENDING (evento "pending" tardio do provedor não desfaz aprovação);
 * - REFUNDED é terminal;
 * - APPROVED <-> REJECTED refletem a verdade mais recente do provedor (ex.: pagamento aprovado
 *   depois cancelado, ou nova tentativa aprovada após rejeição).
 */
export function nextPaymentStatus(
  current: PaymentStatusValue,
  outcome: "approved" | "rejected" | "other",
): PaymentStatusValue {
  const candidate: PaymentStatusValue =
    outcome === "approved" ? "APPROVED" : outcome === "rejected" ? "REJECTED" : "PENDING";
  if (candidate === current) return current;
  if (candidate === "PENDING") return current;
  if (current === "REFUNDED") return current;
  return candidate;
}
