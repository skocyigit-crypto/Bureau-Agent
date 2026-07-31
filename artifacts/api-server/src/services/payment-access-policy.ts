const parsedGraceDays = Number(process.env.PAYMENT_GRACE_DAYS || 7);
export const PAYMENT_GRACE_DAYS = Number.isFinite(parsedGraceDays) ? Math.max(1, parsedGraceDays) : 7;

const BILLING_PATHS = ["/api/subscription", "/api/billing", "/api/license-management"];

export function evaluatePastDueAccess(
  lastPaymentFailedAt: Date | string | null,
  method: string,
  path: string,
  now = new Date(),
): { allowed: boolean; reason?: string; message?: string; graceEndsAt?: string } {
  const failedAt = lastPaymentFailedAt ? new Date(lastPaymentFailedAt) : now;
  const graceEnds = new Date(failedAt.getTime() + PAYMENT_GRACE_DAYS * 86_400_000);
  if (now <= graceEnds) {
    return { allowed: true, reason: "payment_grace", message: `Paiement en retard. Delai de grace de ${PAYMENT_GRACE_DAYS} jours en cours.`, graceEndsAt: graceEnds.toISOString() };
  }
  const billingOrRead = method === "GET" || BILLING_PATHS.some(prefix => path.startsWith(prefix));
  return billingOrRead
    ? { allowed: true, reason: "past_due_read_only", graceEndsAt: graceEnds.toISOString() }
    : { allowed: false, reason: "past_due", message: "Le delai de paiement est depasse. Acces en lecture seule jusqu'au reglement de la facture.", graceEndsAt: graceEnds.toISOString() };
}