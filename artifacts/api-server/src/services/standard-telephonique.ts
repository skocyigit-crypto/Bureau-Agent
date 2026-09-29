/**
 * Secretaire telephonique IA : etat d'appel en base, prise de rendez-vous
 * decidee par le CODE, rappel, note au dossier client, journal d'audit.
 *
 * Le modele comprend la demande ; il ne decide ni de la date retenue, ni de
 * l'ecriture, ni de ce qui est relu a l'appelant :
 *
 *   demande de RDV → date et heure extraites par le modele
 *     manque le jour / l'heure / fuseau inconnu → le code pose LA question
 *     horaire hors delai, hors ouverture ou occupe → le code propose des
 *       creneaux libres calcules (computeFreeSlots)
 *     horaire valide → le code lit date, heure ET fuseau, et demande « oui »
 *   « oui » → rendez-vous cree une seule fois (cle unique voice:<CallSid>),
 *             puis relu tel qu'enregistre
 *   « non » → rien n'est cree
 *
 * Tout ce qui ecrit est revendique dans `voice_call_sessions.actions` par un
 * UPDATE conditionnel : un retry Twilio, une autre instance ou une double
 * confirmation ne creent jamais deux rendez-vous, deux rappels, deux notes.
 */
import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  voiceCallSessionsTable,
  calendarEventsTable,
  contactsTable,
  messagesTable,
  notificationsTable,
} from "@workspace/db";
import { computeFreeSlots, getWorkingHoursConfig, isSlotFree, isSlotWithinWorkingHours, wallClockToUtc } from "./availability";
import { horaireInscriptibleParIa } from "./garde-rendez-vous";
import { AGENTS, creerTacheIa } from "./tache-ia";
import { logAudit } from "../routes/audit";
import { logger } from "../lib/logger";

export type LangueAppel = "fr" | "tr" | "en" | "es" | "de" | "ar";

// ── Etat persiste ──────────────────────────────────────────────────────────

export interface SessionAppelRow {
  orgId: number;
  providerId: number | null;
  status: string;
  etat: Record<string, unknown>;
  actions: Record<string, unknown>;
  lastRequestKey: string | null;
  lastResponse: string | null;
}

/** Cree l'etat d'un appel. Un second `incoming` (retry) ne l'ecrase pas. */
export async function creerSessionAppel(input: {
  orgId: number; providerId: number; callSid: string; etat: Record<string, unknown>;
}): Promise<boolean> {
  const rows = await db.insert(voiceCallSessionsTable).values({
    organisationId: input.orgId,
    providerId: input.providerId,
    callSid: input.callSid,
    state: input.etat,
  }).onConflictDoNothing().returning({ id: voiceCallSessionsTable.id });
  return rows.length > 0;
}

export async function chargerSessionAppel(callSid: string): Promise<SessionAppelRow | null> {
  const [r] = await db.select().from(voiceCallSessionsTable).where(eq(voiceCallSessionsTable.callSid, callSid));
  if (!r) return null;
  return {
    orgId: r.organisationId,
    providerId: r.providerId,
    status: r.status,
    etat: (r.state as Record<string, unknown>) ?? {},
    actions: (r.actions as Record<string, unknown>) ?? {},
    lastRequestKey: r.lastRequestKey,
    lastResponse: r.lastResponse,
  };
}

export async function sauverSessionAppel(callSid: string, orgId: number, etat: Record<string, unknown>, extra: {
  status?: string; requestKey?: string | null; response?: string | null;
} = {}): Promise<void> {
  await db.update(voiceCallSessionsTable).set({
    state: etat,
    updatedAt: new Date(),
    ...(extra.status ? { status: extra.status } : {}),
    ...(extra.requestKey !== undefined ? { lastRequestKey: extra.requestKey } : {}),
    ...(extra.response !== undefined ? { lastResponse: extra.response } : {}),
  }).where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)));
}

/**
 * Revendique une action pour cet appel. Rend `true` a UN SEUL appelant : les
 * autres (retry, instance concurrente) voient la cle deja posee.
 */
export async function revendiquerAction(callSid: string, orgId: number, cle: string, valeur: unknown = true): Promise<boolean> {
  const rows = await db.update(voiceCallSessionsTable).set({
    actions: sql`${voiceCallSessionsTable.actions} || jsonb_build_object(${cle}::text, ${JSON.stringify(valeur)}::jsonb)`,
    updatedAt: new Date(),
  }).where(and(
    eq(voiceCallSessionsTable.callSid, callSid),
    eq(voiceCallSessionsTable.organisationId, orgId),
    sql`not (${voiceCallSessionsTable.actions} ? ${cle})`,
  )).returning({ id: voiceCallSessionsTable.id });
  return rows.length > 0;
}

/** Libere une revendication dont l'action a echoue, pour permettre de reessayer. */
export async function libererAction(callSid: string, orgId: number, cle: string): Promise<void> {
  await db.update(voiceCallSessionsTable).set({
    actions: sql`${voiceCallSessionsTable.actions} - ${cle}::text`,
  }).where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)));
}

export async function poserAction(callSid: string, orgId: number, cle: string, valeur: unknown): Promise<void> {
  await db.update(voiceCallSessionsTable).set({
    actions: sql`${voiceCallSessionsTable.actions} || jsonb_build_object(${cle}::text, ${JSON.stringify(valeur)}::jsonb)`,
  }).where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)));
}

/** Empreinte d'une requete Twilio : une requete rejouee a la meme empreinte. */
export function cleRequete(body: Record<string, unknown>): string {
  const cles = Object.keys(body).sort();
  const brut = cles.map((k) => `${k}=${String(body[k] ?? "")}`).join("&");
  return crypto.createHash("sha256").update(brut).digest("hex");
}

// ── Journal d'audit ────────────────────────────────────────────────────────

/**
 * Evenement d'appel dans `audit_logs` (ajout seul, triggers). L'appelant n'est
 * pas un utilisateur : userId vide, organisation renseignee, ressource = CallSid.
 */
export async function journaliserAppel(orgId: number, callSid: string, action: string, details: Record<string, unknown>): Promise<void> {
  await logAudit(undefined, undefined, `voice.${action}`, "appel_vocal", callSid, details, undefined, "twilio", orgId);
}

// ── Langue : dates, fuseaux, phrases ──────────────────────────────────────

const LOCALE: Record<LangueAppel, string> = { fr: "fr-FR", tr: "tr-TR", en: "en-GB", es: "es-ES", de: "de-DE", ar: "ar" };

export function villeDuFuseau(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

export function fuseauValide(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Date, heure ET fuseau d'un instant, dans la langue de l'appel. C'est ce que
 * l'appelant entend avant de confirmer, puis apres l'enregistrement : le jour
 * de la semaine, la date complete, l'heure, la ville de reference et le nom du
 * fuseau (ete/hiver compris).
 */
export function creneauParle(instant: Date, tz: string, lang: LangueAppel): string {
  const loc = LOCALE[lang];
  const date = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(instant);
  const heure = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(instant);
  const nomFuseau = new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: "long" })
    .formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? tz;
  const ville = villeDuFuseau(tz);
  switch (lang) {
    case "en": return `${date} at ${heure}, ${ville} time (${nomFuseau})`;
    case "tr": return `${date} saat ${heure}, ${ville} saatiyle (${nomFuseau})`;
    case "es": return `${date} a las ${heure}, hora de ${ville} (${nomFuseau})`;
    case "de": return `${date} um ${heure} Uhr, Ortszeit ${ville} (${nomFuseau})`;
    case "ar": return `${date} الساعة ${heure} بتوقيت ${ville} (${nomFuseau})`;
    default: return `${date} à ${heure}, heure de ${ville} (${nomFuseau})`;
  }
}

function heureLocale(instant: Date, tz: string, lang: LangueAppel): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(instant);
}

export const PHRASES: Record<string, Record<LangueAppel, (v: Record<string, string>) => string>> = {
  proposer: {
    fr: (v) => `Je peux vous proposer le ${v.creneau}${v.equivalent}. Confirmez-vous ce rendez-vous ?`,
    en: (v) => `I can offer you ${v.creneau}${v.equivalent}. Do you confirm this appointment?`,
    tr: (v) => `Size ${v.creneau}${v.equivalent} için randevu önerebilirim. Bu randevuyu onaylıyor musunuz?`,
    es: (v) => `Puedo ofrecerle el ${v.creneau}${v.equivalent}. ¿Confirma esta cita?`,
    de: (v) => `Ich kann Ihnen ${v.creneau}${v.equivalent} anbieten. Bestätigen Sie diesen Termin?`,
    ar: (v) => `يمكنني أن أقترح عليك ${v.creneau}${v.equivalent}. هل تؤكد هذا الموعد؟`,
  },
  equivalent: {
    fr: (v) => `, soit ${v.heure} heure de ${v.ville}`,
    en: (v) => `, that is ${v.heure} ${v.ville} time`,
    tr: (v) => `, yani ${v.ville} saatiyle ${v.heure}`,
    es: (v) => `, es decir las ${v.heure} hora de ${v.ville}`,
    de: (v) => `, also ${v.heure} Uhr Ortszeit ${v.ville}`,
    ar: (v) => `، أي الساعة ${v.heure} بتوقيت ${v.ville}`,
  },
  enregistre: {
    fr: (v) => `C'est enregistré : votre rendez-vous est le ${v.creneau}. Puis-je faire autre chose pour vous ?`,
    en: (v) => `It's booked: your appointment is on ${v.creneau}. Is there anything else I can do for you?`,
    tr: (v) => `Kaydedildi: randevunuz ${v.creneau}. Başka bir konuda yardımcı olabilir miyim?`,
    es: (v) => `Queda registrado: su cita es el ${v.creneau}. ¿Puedo ayudarle en algo más?`,
    de: (v) => `Eingetragen: Ihr Termin ist am ${v.creneau}. Kann ich sonst noch etwas für Sie tun?`,
    ar: (v) => `تم التسجيل: موعدك ${v.creneau}. هل يمكنني مساعدتك في شيء آخر؟`,
  },
  alternatives: {
    fr: (v) => `Ce créneau n'est pas disponible. Je peux vous proposer : ${v.liste}. Lequel vous convient ?`,
    en: (v) => `That time is not available. I can offer: ${v.liste}. Which one suits you?`,
    tr: (v) => `Bu saat uygun değil. Şunları önerebilirim: ${v.liste}. Hangisi size uygun?`,
    es: (v) => `Ese horario no está disponible. Puedo proponerle: ${v.liste}. ¿Cuál le conviene?`,
    de: (v) => `Dieser Termin ist nicht frei. Ich kann Ihnen anbieten: ${v.liste}. Welcher passt Ihnen?`,
    ar: (v) => `هذا الموعد غير متاح. يمكنني أن أقترح: ${v.liste}. أيهما يناسبك؟`,
  },
  ou: {
    fr: () => " ; ou le ", en: () => "; or ", tr: () => "; ya da ", es: () => "; o el ", de: () => "; oder ", ar: () => "؛ أو ",
  },
  jour: {
    fr: () => "Pour quel jour souhaitez-vous ce rendez-vous ?",
    en: () => "For which day would you like the appointment?",
    tr: () => "Randevuyu hangi gün istersiniz?",
    es: () => "¿Para qué día desea la cita?",
    de: () => "Für welchen Tag möchten Sie den Termin?",
    ar: () => "في أي يوم تريد الموعد؟",
  },
  heure: {
    fr: () => "À quelle heure vous conviendrait-il ?",
    en: () => "At what time would suit you?",
    tr: () => "Saat kaçta uygun olur?",
    es: () => "¿A qué hora le vendría bien?",
    de: () => "Um wie viel Uhr passt es Ihnen?",
    ar: () => "في أي ساعة يناسبك؟",
  },
  jourEtHeure: {
    fr: () => "Quel jour et à quelle heure souhaitez-vous venir ?",
    en: () => "Which day and at what time would you like to come?",
    tr: () => "Hangi gün ve saat kaçta gelmek istersiniz?",
    es: () => "¿Qué día y a qué hora desea venir?",
    de: () => "An welchem Tag und um wie viel Uhr möchten Sie kommen?",
    ar: () => "في أي يوم وفي أي ساعة تريد الحضور؟",
  },
  fuseau: {
    fr: (v) => `Je n'ai pas compris le fuseau horaire. L'horaire que vous indiquez est-il en heure de ${v.ville} ?`,
    en: (v) => `I didn't catch the time zone. Is the time you mentioned in ${v.ville} time?`,
    tr: (v) => `Saat dilimini anlayamadım. Belirttiğiniz saat ${v.ville} saatine göre mi?`,
    es: (v) => `No he entendido la zona horaria. ¿La hora que indica es hora de ${v.ville}?`,
    de: (v) => `Ich habe die Zeitzone nicht verstanden. Ist die genannte Uhrzeit Ortszeit ${v.ville}?`,
    ar: (v) => `لم أفهم المنطقة الزمنية. هل الوقت الذي ذكرته بتوقيت ${v.ville}؟`,
  },
  horsDelai: {
    fr: () => "Je ne peux fixer un rendez-vous qu'au moins une heure à l'avance et dans les deux prochains mois. Quel autre moment vous conviendrait ?",
    en: () => "I can only book at least one hour ahead and within the next two months. What other time would suit you?",
    tr: () => "Randevuyu en az bir saat önceden ve önümüzdeki iki ay içinde verebilirim. Başka hangi zaman uygun olur?",
    es: () => "Solo puedo dar cita con al menos una hora de antelación y dentro de los próximos dos meses. ¿Qué otro momento le conviene?",
    de: () => "Ich kann Termine nur mindestens eine Stunde im Voraus und innerhalb der nächsten zwei Monate vergeben. Welcher andere Zeitpunkt passt Ihnen?",
    ar: () => "لا يمكنني حجز موعد إلا قبل ساعة على الأقل وخلال الشهرين القادمين. ما الوقت الآخر الذي يناسبك؟",
  },
  refuse: {
    fr: () => "Très bien, je n'enregistre rien. Souhaitez-vous un autre moment ?",
    en: () => "Alright, I won't book anything. Would you like another time?",
    tr: () => "Peki, hiçbir şey kaydetmiyorum. Başka bir zaman ister misiniz?",
    es: () => "De acuerdo, no registro nada. ¿Desea otro momento?",
    de: () => "In Ordnung, ich trage nichts ein. Möchten Sie einen anderen Zeitpunkt?",
    ar: () => "حسناً، لن أسجل شيئاً. هل تريد وقتاً آخر؟",
  },
  ouiOuNon: {
    fr: () => "Pour être sûre : confirmez-vous ce rendez-vous, oui ou non ?",
    en: () => "Just to be sure: do you confirm this appointment, yes or no?",
    tr: () => "Emin olmak için: bu randevuyu onaylıyor musunuz, evet mi hayır mı?",
    es: () => "Para estar segura: ¿confirma esta cita, sí o no?",
    de: () => "Nur zur Sicherheit: Bestätigen Sie diesen Termin, ja oder nein?",
    ar: () => "للتأكد: هل تؤكد هذا الموعد، نعم أم لا؟",
  },
  erreurEnregistrement: {
    fr: () => "Un problème technique m'a empêchée d'enregistrer le rendez-vous. Pouvez-vous me le confirmer à nouveau ?",
    en: () => "A technical problem prevented me from saving the appointment. Could you confirm it again?",
    tr: () => "Teknik bir sorun randevuyu kaydetmemi engelledi. Tekrar onaylayabilir misiniz?",
    es: () => "Un problema técnico me impidió registrar la cita. ¿Puede confirmármela de nuevo?",
    de: () => "Ein technisches Problem hat das Speichern des Termins verhindert. Können Sie ihn erneut bestätigen?",
    ar: () => "منعتني مشكلة تقنية من تسجيل الموعد. هل يمكنك تأكيده مرة أخرى؟",
  },
  agendaIndisponible: {
    fr: () => "Je ne parviens pas à consulter l'agenda pour le moment.",
    en: () => "I can't access the calendar at the moment.",
    tr: () => "Şu anda takvime erişemiyorum.",
    es: () => "No consigo consultar la agenda en este momento.",
    de: () => "Ich kann den Kalender im Moment nicht einsehen.",
    ar: () => "لا أستطيع الوصول إلى التقويم في الوقت الحالي.",
  },
  rappelCree: {
    fr: () => "J'ai enregistré une demande de rappel : l'équipe vous rappellera dès que possible au numéro depuis lequel vous appelez. Au revoir.",
    en: () => "I've logged a callback request: the team will call you back as soon as possible on the number you are calling from. Goodbye.",
    tr: () => "Geri arama talebinizi kaydettim: ekibimiz sizi aradığınız numaradan en kısa sürede arayacak. Hoşça kalın.",
    es: () => "He registrado una solicitud de devolución de llamada: el equipo le llamará lo antes posible al número desde el que llama. Adiós.",
    de: () => "Ich habe eine Rückrufbitte eingetragen: Das Team ruft Sie so bald wie möglich unter der Nummer zurück, von der Sie anrufen. Auf Wiederhören.",
    ar: () => "سجلت طلب معاودة اتصال: سيتصل بك الفريق في أقرب وقت على الرقم الذي تتصل منه. مع السلامة.",
  },
  transfertEchoue: {
    fr: () => "Personne n'est disponible pour le moment.",
    en: () => "No one is available at the moment.",
    tr: () => "Şu anda kimse müsait değil.",
    es: () => "No hay nadie disponible en este momento.",
    de: () => "Im Moment ist niemand erreichbar.",
    ar: () => "لا أحد متاح في الوقت الحالي.",
  },
};

export function phrase(cle: keyof typeof PHRASES, lang: LangueAppel, v: Record<string, string> = {}): string {
  return (PHRASES[cle]![lang] ?? PHRASES[cle]!.fr)(v);
}

// ── Oui / non ──────────────────────────────────────────────────────────────

function normaliser(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,!?;:¿¡'’"]/g, " ").replace(/\s+/g, " ").trim();
}

const NON: Record<LangueAppel, RegExp> = {
  fr: /\b(non|pas du tout|pas ca|ne me convient pas|ca ne me va pas|je ne veux pas|annulez?|surtout pas)\b/,
  en: /\b(no|nope|not|don t|do not|cancel|wrong)\b/,
  tr: /\b(hayir|istemiyorum|olmaz|iptal|uygun degil)\b/,
  es: /\b(no|para nada|cancele|cancelar)\b/,
  de: /\b(nein|nicht|abbrechen|lieber nicht)\b/,
  ar: /(^|\s)(لا|كلا|ألغ)/,
};
const OUI: Record<LangueAppel, RegExp> = {
  fr: /\b(oui|ouais|d accord|parfait|c est bon|je confirme|confirme|exactement|tout a fait|ok|okay|entendu|volontiers)\b/,
  en: /\b(yes|yeah|yep|sure|correct|confirm|confirmed|that s right|ok|okay|perfect|fine)\b/,
  tr: /\b(evet|tamam|olur|onayliyorum|dogru|uygun|peki)\b/,
  es: /\b(si|vale|de acuerdo|confirmo|correcto|perfecto|claro)\b/,
  de: /\b(ja|genau|einverstanden|bestatige|bestaetige|passt|richtig|gut)\b/,
  ar: /(نعم|أجل|موافق|حسنا|تمام)/,
};

/**
 * Lit un oui ou un non explicite. Le NON est cherche en premier : « non, pas
 * mardi » n'est pas un accord parce que la phrase contient « mardi ». Rien de
 * clair → null, et c'est le modele (puis une question fermee) qui tranche.
 */
export function ouiOuNon(parole: string, lang: LangueAppel): "oui" | "non" | null {
  const t = normaliser(parole);
  if (!t) return null;
  if (NON[lang].test(t) || NON.fr.test(t)) return "non";
  if (OUI[lang].test(t) || OUI.fr.test(t)) return "oui";
  return null;
}

// ── Decision de rendez-vous ───────────────────────────────────────────────

export interface DemandeRdv { date: string | null; heure: string | null; fuseau: string | null }

export type DecisionRdv =
  | { type: "clarifier"; manque: "jour" | "heure" | "jourEtHeure" | "fuseau" | "horsDelai"; fuseau?: string }
  | { type: "alternatives"; creneaux: Array<{ debutIso: string; finIso: string }>; fuseau: string }
  | { type: "aucun_creneau" }
  | { type: "agenda_indisponible" }
  | { type: "proposer"; debutIso: string; finIso: string; fuseau: string; fuseauDemande: string };

/**
 * Transforme « mardi 14 h 30 » (deja ramene par le modele en date + heure
 * murales) en creneau reel, ou dit ce qui manque. Le fuseau de reference est
 * celui des rendez-vous de l'organisation ; un fuseau cite par l'appelant est
 * converti, jamais ignore. Horaire mural → instant : `wallClockToUtc`, qui
 * connait les changements d'heure — jamais `new Date("...T14:30:00")`, que
 * Node lit dans le fuseau du SERVEUR (UTC en production).
 */
export async function deciderRendezVous(orgId: number, d: DemandeRdv, maintenant = new Date()): Promise<DecisionRdv> {
  const date = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
  const heure = d.heure && /^\d{1,2}:\d{2}$/.test(d.heure) ? d.heure : null;
  if (!date && !heure) return { type: "clarifier", manque: "jourEtHeure" };
  if (!date) return { type: "clarifier", manque: "jour" };
  if (!heure) return { type: "clarifier", manque: "heure" };

  let cfg: Awaited<ReturnType<typeof getWorkingHoursConfig>>;
  try { cfg = await getWorkingHoursConfig(orgId); } catch { return { type: "agenda_indisponible" }; }
  const fuseauDemande = d.fuseau && d.fuseau.trim() ? d.fuseau.trim() : cfg.timezone;
  if (!fuseauValide(fuseauDemande)) return { type: "clarifier", manque: "fuseau", fuseau: cfg.timezone };

  const [y, mo, j] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = heure.split(":").map(Number) as [number, number];
  if (mo < 1 || mo > 12 || j < 1 || j > 31 || hh > 23 || mm > 59) return { type: "clarifier", manque: "jourEtHeure" };
  const debut = wallClockToUtc(y, mo, j, hh, mm, fuseauDemande);
  const fin = new Date(debut.getTime() + cfg.defaultDurationMinutes * 60_000);
  if (!horaireInscriptibleParIa(debut, maintenant)) return { type: "clarifier", manque: "horsDelai" };

  let libre: boolean;
  try {
    libre = await isSlotWithinWorkingHours({ orgId, start: debut, end: fin }) && await isSlotFree({ orgId, start: debut, end: fin });
  } catch (err) {
    logger.warn({ err, orgId }, "[standard] verification d'agenda impossible");
    return { type: "agenda_indisponible" };
  }
  if (libre) {
    return { type: "proposer", debutIso: debut.toISOString(), finIso: fin.toISOString(), fuseau: cfg.timezone, fuseauDemande };
  }

  // Occupe ou hors ouverture : les creneaux libres les plus proches, a partir
  // du jour demande (puis, a defaut, des maintenant).
  try {
    const depuisJour = new Date(Math.max(maintenant.getTime(), debut.getTime() - 12 * 3600_000));
    let creneaux = await computeFreeSlots({ orgId, from: depuisJour, to: new Date(depuisJour.getTime() + 7 * 86400_000), limit: 3 });
    if (creneaux.length === 0) {
      creneaux = await computeFreeSlots({ orgId, from: maintenant, to: new Date(maintenant.getTime() + 14 * 86400_000), limit: 3 });
    }
    if (creneaux.length === 0) return { type: "aucun_creneau" };
    return { type: "alternatives", creneaux: creneaux.map((c) => ({ debutIso: c.start, finIso: c.end })), fuseau: cfg.timezone };
  } catch (err) {
    logger.warn({ err, orgId }, "[standard] calcul des creneaux impossible");
    return { type: "agenda_indisponible" };
  }
}

/** Ce que l'appelant entend pour chaque decision. */
export function phraseDecision(dec: DecisionRdv, lang: LangueAppel): string {
  switch (dec.type) {
    case "clarifier":
      return dec.manque === "fuseau" ? phrase("fuseau", lang, { ville: villeDuFuseau(dec.fuseau ?? "Europe/Paris") }) : phrase(dec.manque, lang);
    case "alternatives": {
      // Le fuseau des creneaux est celui de l'organisation, dit pour chacun.
      return phrase("alternatives", lang, {
        liste: dec.creneaux.map((c) => creneauParle(new Date(c.debutIso), dec.fuseau, lang)).join(phrase("ou", lang)),
      });
    }
    case "proposer": {
      const debut = new Date(dec.debutIso);
      const equivalent = dec.fuseauDemande !== dec.fuseau
        ? phrase("equivalent", lang, { heure: heureLocale(debut, dec.fuseauDemande, lang), ville: villeDuFuseau(dec.fuseauDemande) })
        : "";
      return phrase("proposer", lang, { creneau: creneauParle(debut, dec.fuseau, lang), equivalent });
    }
    case "agenda_indisponible": return phrase("agendaIndisponible", lang);
    case "aucun_creneau": return phrase("agendaIndisponible", lang);
  }
}

// ── Dossier client ────────────────────────────────────────────────────────

/**
 * Le contact de l'appelant : le numero compare sur ses 9 derniers chiffres,
 * l'egalite exacte des chiffres d'abord, puis le plus recemment modifie — un
 * ordre stable, plus un `limit(1)` au hasard. Cree si absent ET si l'appel a
 * produit quelque chose a rattacher (rendez-vous, rappel).
 */
export async function contactDeLAppelant(orgId: number, telephone: string, nom: string | null, creerSiAbsent: boolean): Promise<number | null> {
  const chiffres = (telephone || "").replace(/\D/g, "");
  if (chiffres.length >= 6) {
    const suffixe = `%${chiffres.slice(-9)}`;
    const [c] = await db.select({ id: contactsTable.id }).from(contactsTable)
      .where(and(
        eq(contactsTable.organisationId, orgId),
        sql`regexp_replace(coalesce(${contactsTable.phone}, ''), '\\D', '', 'g') LIKE ${suffixe}`,
      ))
      .orderBy(
        desc(sql`regexp_replace(coalesce(${contactsTable.phone}, ''), '\\D', '', 'g') = ${chiffres}`),
        desc(contactsTable.updatedAt),
      )
      .limit(1);
    if (c) return c.id;
  }
  if (!creerSiAbsent || chiffres.length < 6) return null;
  const mots = (nom ?? "").trim().split(/\s+/).filter(Boolean);
  const [cree] = await db.insert(contactsTable).values({
    organisationId: orgId,
    firstName: mots[0] ?? "Appelant",
    lastName: mots.slice(1).join(" ") || `…${chiffres.slice(-4)}`,
    phone: telephone,
    notes: null,
  }).returning({ id: contactsTable.id });
  return cree?.id ?? null;
}

/** Ajoute un bloc de note au dossier du contact, et compte l'appel. */
export async function noterAuDossier(orgId: number, contactId: number, bloc: string): Promise<void> {
  await db.update(contactsTable).set({
    notes: sql`case when coalesce(${contactsTable.notes}, '') = '' then ${bloc} else ${contactsTable.notes} || E'\\n\\n' || ${bloc} end`,
    totalCalls: sql`${contactsTable.totalCalls} + 1`,
    lastCallAt: new Date(),
  }).where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)));
}

// ── Rendez-vous confirme, demande de rappel ───────────────────────────────

export const refRendezVous = (callSid: string) => `voice:${callSid}`;

/**
 * Cree le rendez-vous que l'appelant vient de confirmer. Une seule fois par
 * appel : la cle `external_ref` est unique par organisation — un second essai
 * (retry, double « oui », autre instance) retrouve le premier au lieu d'en
 * creer un autre. Le creneau est reverifie : l'agenda a pu bouger pendant
 * l'appel.
 */
export async function creerRendezVousConfirme(input: {
  orgId: number; callSid: string; debut: Date; fin: Date; nom: string; motif: string;
  telephone: string; contactId: number | null;
}): Promise<{ eventId: number; nouveau: boolean } | { occupe: true }> {
  const ref = refRendezVous(input.callSid);
  const [existant] = await db.select({ id: calendarEventsTable.id }).from(calendarEventsTable)
    .where(and(eq(calendarEventsTable.organisationId, input.orgId), eq(calendarEventsTable.externalRef, ref)));
  if (existant) return { eventId: existant.id, nouveau: false };

  if (!(await isSlotFree({ orgId: input.orgId, start: input.debut, end: input.fin }))) {
    // Occupe… peut-etre par NOTRE rendez-vous, cree a l'instant par une
    // confirmation simultanee du meme appel : on relit avant de dire « pris ».
    const [notre] = await db.select({ id: calendarEventsTable.id }).from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.organisationId, input.orgId), eq(calendarEventsTable.externalRef, ref)));
    return notre ? { eventId: notre.id, nouveau: false } : { occupe: true };
  }

  const rows = await db.insert(calendarEventsTable).values({
    organisationId: input.orgId,
    title: `RDV (appel) : ${input.nom || input.telephone}`,
    description: `Motif : ${input.motif || "non précisé"}\nPris et confirmé par l'appelant avec la secrétaire téléphonique IA.\nTéléphone : ${input.telephone}`,
    type: "rendez_vous",
    startDate: input.debut,
    endDate: input.fin,
    color: "#f59e0b",
    reminder: "15min",
    contactName: input.nom || null,
    contactPhone: input.telephone,
    relatedContactId: input.contactId,
    status: "confirme",
    priority: "normale",
    externalRef: ref,
  }).onConflictDoNothing().returning({ id: calendarEventsTable.id });
  if (rows[0]) return { eventId: rows[0].id, nouveau: true };
  // Course perdue contre une confirmation simultanee : on relit l'autre.
  const [gagnant] = await db.select({ id: calendarEventsTable.id }).from(calendarEventsTable)
    .where(and(eq(calendarEventsTable.organisationId, input.orgId), eq(calendarEventsTable.externalRef, ref)));
  return { eventId: gagnant!.id, nouveau: false };
}

/**
 * Demande de rappel : un message « rappel » rattache au contact, une tache
 * assignee, une notification. Rend l'id du message et celui de la tache (que
 * l'appel rattache a sa fiche a la cloture). Une seule par appel (revendiquee
 * par l'appelant de cette fonction).
 */
export async function creerDemandeRappel(input: {
  orgId: number; callSid: string; telephone: string; nom: string | null; contactId: number | null;
  raison: string; demande: string;
}): Promise<{ messageId: number; tacheId: number | null }> {
  const [m] = await db.insert(messagesTable).values({
    organisationId: input.orgId,
    contactId: input.contactId,
    phoneNumber: input.telephone || "inconnu",
    contactName: input.nom,
    content: `Demande de rappel — ${input.raison}.\nDemande de l'appelant : ${input.demande || "non précisée"}`,
    type: "rappel",
    priority: "haute",
  }).returning({ id: messagesTable.id });
  const tache = await creerTacheIa({
    organisationId: input.orgId,
    agent: AGENTS.secretaireAutonome,
    nature: "commercial",
    title: `Rappeler ${input.nom || input.telephone} (${input.raison})`,
    description: `Demande : ${input.demande || "non précisée"}\nTéléphone : ${input.telephone}`,
    priority: "haute",
    dueDate: new Date(Date.now() + 2 * 3600_000),
    relatedContactId: input.contactId,
  }).catch((err) => { logger.warn({ err, orgId: input.orgId }, "[standard] tache de rappel non creee"); return null; });
  await db.insert(notificationsTable).values({
    organisationId: input.orgId,
    type: "alerte",
    title: "Demande de rappel (secrétaire IA)",
    message: `${input.nom || input.telephone} attend un rappel : ${input.raison}.`,
    priority: "haute",
    actionUrl: "/messages",
    sourceType: "ai_receptionist_callback",
    sourceId: String(m!.id),
  });
  return { messageId: m!.id, tacheId: tache?.id ?? null };
}
