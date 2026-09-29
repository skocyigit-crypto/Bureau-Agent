/**
 * Les transcriptions d'appel s'effacent a 12 mois — toutes, pas seulement
 * celle du journal telephonique.
 *
 * La politique de confidentialite promet : « Enregistrements d'appels : 12
 * mois. Passe ce delai, l'enregistrement et sa transcription sont effaces
 * automatiquement. » `purgeExpiredCallRecordings` vidait
 * `telephony_call_logs.transcription` — mais la meme transcription est ecrite
 * a trois autres endroits, jamais purges (mesure du 29/09) :
 *
 *   - `calls.notes` : la secretaire IA y ajoute « [Secretaire telephonique IA] »
 *     suivi de l'echange complet ; `POST /calls/ai-agent-save` y ajoute
 *     « Transcription: » suivi de l'echange ;
 *   - `messages.content` : le repondeur y met la transcription du message vocal ;
 *   - `notifications.message` : ses 140 premiers caracteres.
 *
 * Ce qu'on garde : la fiche d'appel, le resume et les intentions detectees.
 * Ce sont les notes de travail du client, pas la parole enregistree de
 * l'appelant — la promesse porte sur « l'enregistrement et sa transcription ».
 */
import { and, eq, gt, isNotNull, like, lt, or, sql } from "drizzle-orm";

export const MARQUEUR_EFFACE = "[transcription effacee apres 12 mois]";
const SECRETAIRE = "[Secretaire telephonique IA]\n";
const AGENT_IA = "\nTranscription:\n";

/**
 * Une ligne de l'echange : « Appelant: ... » / « Secretaire: ... » (secretaire
 * IA, six langues) ou « [Sophie] ... » / « [Client] ... » (agent IA).
 */
const TOUR = /^(?:\[[^\]\n]{1,40}\] |(?:Appelant|Arayan|Caller|Llamante|Anrufer|المتصل|Secretaire|Sekreter|Receptionist|Recepcionista|Sekretariat|الاستقبال): )/;

/**
 * Les notes sans la transcription, ou `null` s'il n'y a rien a retirer.
 *
 * On retire les lignes d'echange qui suivent l'en-tete — et elles seules.
 * Couper jusqu'a la fin serait plus simple, mais le client peut avoir ajoute
 * ses propres notes apres l'appel, et `updated_at` ne permet pas de le savoir
 * (il bouge a chaque mise a jour, y compris la notre). Effacer la note d'un
 * client pour tenir une duree de conservation serait une perte de donnees.
 * Limite assumee : la suite d'une replique ecrite sur plusieurs lignes reste.
 */
export function retirerTranscription(notes: string): string | null {
  const lignes = notes.replace(/\r\n/g, "\n").split("\n");
  for (const entete of [SECRETAIRE.trim(), AGENT_IA.trim()]) {
    const i = lignes.findIndex((l) => l.trim() === entete);
    if (i < 0) continue;
    let fin = i + 1;
    while (fin < lignes.length && TOUR.test(lignes[fin]!)) fin++;
    if (fin === i + 1) return null;
    return [...lignes.slice(0, i + 1), MARQUEUR_EFFACE, ...lignes.slice(fin)].join("\n");
  }
  return null;
}

const LOT = 500;

/**
 * Applique la duree aux trois copies. Renvoie le nombre de lignes reecrites
 * par table. A appeler AVANT la purge de `telephony_call_logs` : c'est sa
 * transcription qui permet de reconnaitre le message vocal correspondant.
 */
export async function purgerTranscriptionsExpirees(limite: Date): Promise<{ appels: number; messagesVocaux: number; notifications: number }> {
  const { db, callsTable, messagesTable, notificationsTable, telephonyCallLogsTable } = await import("@workspace/db");

  // 1. Notes d'appel, par lots (une note peut peser plusieurs dizaines de Ko).
  let appels = 0;
  let curseur = 0;
  for (;;) {
    const lot = await db.select({ id: callsTable.id, organisationId: callsTable.organisationId, notes: callsTable.notes })
      .from(callsTable)
      .where(and(
        gt(callsTable.id, curseur),
        lt(callsTable.createdAt, limite),
        isNotNull(callsTable.notes),
        or(like(callsTable.notes, "%[Secretaire telephonique IA]%"), like(callsTable.notes, "%Transcription:%")),
      ))
      .orderBy(callsTable.id)
      .limit(LOT);
    if (lot.length === 0) break;
    for (const c of lot) {
      const nouvelles = retirerTranscription(c.notes ?? "");
      if (nouvelles === null) continue;
      await db.update(callsTable).set({ notes: nouvelles })
        .where(and(eq(callsTable.id, c.id), eq(callsTable.organisationId, c.organisationId)));
      appels++;
    }
    curseur = lot[lot.length - 1]!.id;
    if (lot.length < LOT) break;
  }

  // 2. Messages vocaux : reconnus par la transcription identique ecrite au
  // meme moment dans le journal telephonique (marque `voicemail`). Aucun autre
  // message n'est touche — un rappel demande ou une note manuelle garde son
  // texte.
  const vocaux = await db.update(messagesTable)
    .set({ content: `(message vocal) ${MARQUEUR_EFFACE}` })
    .from(telephonyCallLogsTable)
    .where(and(
      lt(messagesTable.createdAt, limite),
      eq(messagesTable.type, "appel"),
      eq(telephonyCallLogsTable.organisationId, messagesTable.organisationId),
      sql`${telephonyCallLogsTable.metadata}->>'voicemail' = 'true'`,
      eq(telephonyCallLogsTable.transcription, messagesTable.content),
      sql`abs(extract(epoch from ${telephonyCallLogsTable.createdAt} - ${messagesTable.createdAt})) < 300`,
    ));

  // 3. Notifications du repondeur : leur texte EST l'extrait de transcription.
  const notifs = await db.update(notificationsTable)
    .set({ message: `Message vocal — ${MARQUEUR_EFFACE}` })
    .where(and(
      lt(notificationsTable.createdAt, limite),
      eq(notificationsTable.sourceType, "ai_receptionist_voicemail"),
      sql`${notificationsTable.message} NOT LIKE ${"%" + MARQUEUR_EFFACE}`,
    ));

  return {
    appels,
    messagesVocaux: (vocaux as { rowCount?: number }).rowCount ?? 0,
    notifications: (notifs as { rowCount?: number }).rowCount ?? 0,
  };
}
