import crypto from "crypto";

// Pas de contrainte unique en base pour devis.reference / factures_client.reference
// (changement de schema hors scope) — on reduit le risque de collision au niveau
// applicatif: horodatage + suffixe aleatoire, verifie contre l'existant avant insert.
// Fenetre de course residuelle minime (check-puis-insert non verrouille) mais un
// gain net face a l'ancien `FAC-${Date.now()}` seul, sujet a collision sous charge
// concurrente (Cloud Run maxScale=3).
export async function generateUniqueReference(
  prefix: string,
  existsAlready: (candidate: string) => Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    if (!(await existsAlready(candidate))) return candidate;
  }
  return `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}
