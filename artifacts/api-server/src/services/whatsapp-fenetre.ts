/**
 * Fenetre de service client WhatsApp (regle Meta).
 *
 * Un message libre ne peut etre envoye que dans les 24 heures qui suivent le
 * DERNIER message recu du client. Passe ce delai, WhatsApp n'accepte qu'un
 * modele (template) approuve ; Twilio refuse l'envoi (erreur 63016) et
 * l'ecran affichait ce refus brut apres coup.
 */
export const FENETRE_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export type EtatFenetre =
  | { ouverte: true; fermeLe: Date }
  | { ouverte: false; raison: "aucun_message_client" | "expiree"; fermeeLe: Date | null };

export function etatFenetre(dernierMessageClient: Date | null, maintenant = new Date()): EtatFenetre {
  if (!dernierMessageClient) return { ouverte: false, raison: "aucun_message_client", fermeeLe: null };
  const fin = new Date(dernierMessageClient.getTime() + FENETRE_WHATSAPP_MS);
  return fin.getTime() > maintenant.getTime()
    ? { ouverte: true, fermeLe: fin }
    : { ouverte: false, raison: "expiree", fermeeLe: fin };
}

export function messageFenetreFermee(etat: Extract<EtatFenetre, { ouverte: false }>): string {
  return etat.raison === "aucun_message_client"
    ? "Ce client ne vous a jamais écrit sur WhatsApp : un premier message doit utiliser un modèle approuvé par WhatsApp. Appelez-le ou envoyez un SMS."
    : "Le client ne vous a pas écrit depuis plus de 24 heures : WhatsApp n'autorise plus de message libre. Appelez-le, envoyez un SMS, ou attendez qu'il vous réécrive.";
}
