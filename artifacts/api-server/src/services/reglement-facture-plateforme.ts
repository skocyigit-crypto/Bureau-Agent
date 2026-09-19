/**
 * L'etat d'une facture de la plateforme, d'apres ce qui a REELLEMENT ete
 * encaisse.
 *
 * Le defaut : affecter un paiement a une facture la passait en « payee » quel
 * que soit son montant. Un virement de 5 EUR rapproche d'une facture de 490
 * EUR la soldait — l'editeur perdait 485 EUR, la licence restait ouverte
 * (`invalidateLicenseCache` suit ce statut), et plus rien ne signalait
 * l'impaye. Un paiement partiel n'a pourtant rien d'exotique : virement
 * tronque, acompte, frais bancaires preleves en route.
 *
 * On raisonne en centimes : `0.1 + 0.2 > 0.3` est vrai en flottant, ce qui
 * suffirait a laisser une facture eternellement « partielle » a un centime
 * pres.
 */
export type StatutFacturePlateforme = "payee" | "partiel" | "en_attente";

/** Somme en centimes, tolerante aux `numeric` rendus en chaine. */
export function centimes(valeur: string | number | null | undefined): number {
  const n = typeof valeur === "number" ? valeur : Number(valeur ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * @param duCentimes      ce que le client doit (TTC).
 * @param encaisseCentimes ce qui a ete rapproche de cette facture.
 */
export function statutFacturePlateforme(
  duCentimes: number,
  encaisseCentimes: number,
): StatutFacturePlateforme {
  if (encaisseCentimes <= 0) return "en_attente";
  // Une facture de montant nul (avoir integral, periode offerte) est soldee
  // des qu'on la regarde: exiger un paiement la laisserait « en attente » pour
  // toujours.
  if (duCentimes <= 0) return "payee";
  return encaisseCentimes >= duCentimes ? "payee" : "partiel";
}
