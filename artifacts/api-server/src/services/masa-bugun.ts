/**
 * « Aujourd'hui » : la table de decision du bureau (plan du 29/09, section 3).
 *
 * Le tableau de bord etait une vitrine : une photo, une horloge, des
 * compteurs, trois panneaux d'IA — seule la liste des contacts frequents
 * ouvrait un enregistrement. Ici, chaque ligne EST un enregistrement : un appel,
 * une proposition, un rendez-vous, un devis, une facture, une execution
 * d'agent. Elle dit qui en repond et quand, et mene a sa fiche. Une alerte qui
 * n'a ni source ni responsable n'a pas sa place ici.
 *
 * Six panneaux :
 *  - maintenant : appel en cours, rappel du, probleme de chantier urgent,
 *    approbation qui expire ;
 *  - approbations : la file d'attente, avec l'echeance de chaque decision ;
 *  - plan du jour : rendez-vous (visites distinguees), taches du jour,
 *    livraisons a 7 jours ;
 *  - dossiers : nouvelles demandes, devis envoyes sans reponse, chantiers en
 *    retard ;
 *  - finances : factures echues, depassements de budget, devis acceptes non
 *    factures — chaque montant avec sa source ;
 *  - agents : en cours, rendu a un humain, en erreur, connexion manquante.
 *
 * Aucune ligne n'est inventee : un panneau vide dit « rien », il ne se remplit
 * pas de conseils generiques.
 */
import {
  db, agentProposalsTable, agentRunsTable, calendarEventsTable, callsTable, devisTable, facturesClientTable,
  googleOAuthTokensTable, messagesTable, projetsTable, prospectsTable, tasksTable, telephonyProvidersTable, usersTable,
  voiceCallSessionsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, notExists, notInArray, sql } from "drizzle-orm";
import { getAnthropicMode } from "@workspace/integrations-anthropic-ai";
import { bornesDuJour } from "../lib/jour-local";
import { overdueCondition } from "./invoice-status";

/** bilgi = a savoir ; onay = attend une decision humaine ; acil = erreur ou urgence. */
export type Ton = "bilgi" | "onay" | "acil";

export type Satir = {
  /** Unique dans la reponse : `<tur>:<id>`. */
  cle: string;
  /** Nature de la ligne ; le client en tire le libelle traduit. */
  tur: string;
  /** Le titre de l'enregistrement lui-meme (donnee, pas texte d'interface). */
  baslik: string;
  detay: string | null;
  /** Fiche de l'enregistrement. */
  href: string;
  sorumlu: string | null;
  /** Instant qui compte pour la ligne (echeance, debut, reception). */
  zaman: string | null;
  ton: Ton;
  tutar?: number;
  para?: string;
};

export type Rubrique = { satirlar: Satir[]; fazlasi: boolean };

export type MasaBugun = {
  simdi: Rubrique;
  onaylar: Rubrique & { toplam: number };
  plan: Rubrique;
  dosyalar: Rubrique;
  finans: Rubrique;
  ajanlar: Rubrique & { sayac: { calisiyor: number; bekliyor: number; hata: number } };
  uretildi: string;
};

/** Lignes par categorie ; une de plus pour savoir s'il en reste. */
const PAR_CATEGORIE = 5;
const JOUR = 24 * 60 * 60 * 1000;
/** `expireStaleProposals` (proposal-queue.ts) expire une proposition apres 14 jours. */
export const DUREE_DE_VIE_PROPOSITION_JOURS = 14;
/** Une approbation « expire bientot » quand il lui reste 3 jours ou moins. */
const ALERTE_EXPIRATION_JOURS = 3;
const TERMINE_PROJET = ["termine", "annule"];
const TERMINE_TACHE = ["termine", "annule"];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const nombre = (v: unknown) => (v == null ? 0 : Number(v));

function rubrique(listes: Satir[][]): Rubrique {
  return {
    satirlar: listes.flatMap((l) => l.slice(0, PAR_CATEGORIE)),
    fazlasi: listes.some((l) => l.length > PAR_CATEGORIE),
  };
}

/** Echeance de decision d'une proposition : creation + 14 jours. */
export function echeanceProposition(creeLe: Date): Date {
  return new Date(creeLe.getTime() + DUREE_DE_VIE_PROPOSITION_JOURS * JOUR);
}

/** Un fournisseur d'IA est-il configure ? Meme regle que GET /ai/status. */
export function iaDisponible(env: NodeJS.ProcessEnv = process.env): boolean {
  const gemini = !!(env.AI_INTEGRATIONS_GEMINI_BASE_URL && env.AI_INTEGRATIONS_GEMINI_API_KEY)
    || !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY);
  const openai = !!(env.AI_INTEGRATIONS_OPENAI_BASE_URL && env.AI_INTEGRATIONS_OPENAI_API_KEY) || !!env.OPENAI_API_KEY;
  let anthropic = false;
  try { anthropic = getAnthropicMode() !== "none"; } catch { anthropic = false; }
  return gemini || openai || anthropic;
}

/**
 * `assigned_to` est un texte libre : un identifiant d'utilisateur (ecrit par
 * les agents) ou un nom saisi a la main. On rend un nom dans les deux cas.
 */
function nommer(valeur: string | number | null | undefined, noms: Map<number, string>): string | null {
  if (valeur == null || valeur === "") return null;
  const id = typeof valeur === "number" ? valeur : /^\d+$/.test(valeur.trim()) ? Number(valeur.trim()) : null;
  if (id != null) return noms.get(id) ?? null;
  return String(valeur).trim() || null;
}

export async function construireMasaBugun(orgId: number, maintenant: Date = new Date()): Promise<MasaBugun> {
  const { debut, fin } = bornesDuJour(maintenant);
  const ilYa7j = new Date(maintenant.getTime() - 7 * JOUR);
  const dans7j = new Date(maintenant.getTime() + 7 * JOUR);
  const ilYa24h = new Date(maintenant.getTime() - JOUR);
  const limite = PAR_CATEGORIE + 1;

  const noms = new Map<number, string>();
  for (const u of await db.select({ id: usersTable.id, prenom: usersTable.prenom, nom: usersTable.nom })
    .from(usersTable).where(eq(usersTable.organisationId, orgId))) {
    noms.set(u.id, [u.prenom, u.nom].filter(Boolean).join(" ").trim() || `#${u.id}`);
  }

  // ---- Maintenant -----------------------------------------------------------
  // Par petits lots : la requete ne doit pas prendre quinze connexions du pool
  // d'un coup a chaque ouverture du tableau de bord.
  const [enLigne, appelsEnCours, rappels, demandesRappel, urgences, expirent] = await Promise.all([
    db.select({ id: voiceCallSessionsTable.id, state: voiceCallSessionsTable.state, status: voiceCallSessionsTable.status, createdAt: voiceCallSessionsTable.createdAt })
      .from(voiceCallSessionsTable)
      .where(and(
        eq(voiceCallSessionsTable.organisationId, orgId),
        inArray(voiceCallSessionsTable.status, ["en_cours", "transfert"]),
        isNull(voiceCallSessionsTable.finalizedAt),
        // Le balayage (voice-receptionist) clot les sessions muettes depuis 30 min.
        gt(voiceCallSessionsTable.updatedAt, new Date(maintenant.getTime() - 30 * 60 * 1000)),
      ))
      .orderBy(desc(voiceCallSessionsTable.createdAt)).limit(limite),
    db.select({ id: callsTable.id, contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, createdAt: callsTable.createdAt, createdBy: callsTable.createdBy })
      .from(callsTable)
      .where(and(eq(callsTable.organisationId, orgId), eq(callsTable.status, "en_cours")))
      .orderBy(desc(callsTable.createdAt)).limit(limite),
    // Appel entrant manque : « rappele » quand une tache s'y rattache
    // (`tasks.related_call_id`), meme regle que le moteur proactif.
    db.select({ id: callsTable.id, contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber, status: callsTable.status, createdAt: callsTable.createdAt })
      .from(callsTable)
      .where(and(
        eq(callsTable.organisationId, orgId),
        eq(callsTable.direction, "entrant"),
        inArray(callsTable.status, ["manque", "messagerie"]),
        gte(callsTable.createdAt, ilYa7j),
        notExists(db.select({ un: sql`1` }).from(tasksTable).where(and(
          eq(tasksTable.organisationId, orgId),
          eq(tasksTable.relatedCallId, callsTable.id),
        ))),
      ))
      .orderBy(asc(callsTable.createdAt)).limit(limite),
    // Demande de rappel prise par la secretaire IA (message « rappel » non lu).
    db.select({ id: messagesTable.id, contactName: messagesTable.contactName, phoneNumber: messagesTable.phoneNumber, content: messagesTable.content, createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(and(eq(messagesTable.organisationId, orgId), eq(messagesTable.type, "rappel"), eq(messagesTable.isRead, false)))
      .orderBy(asc(messagesTable.createdAt)).limit(limite),
    // Probleme de chantier urgent : tache prioritaire rattachee a un chantier.
    db.select({ id: tasksTable.id, title: tasksTable.title, assignedTo: tasksTable.assignedTo, dueDate: tasksTable.dueDate, projetId: tasksTable.projetId })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organisationId, orgId),
        inArray(tasksTable.priority, ["haute", "urgente"]),
        notInArray(tasksTable.status, TERMINE_TACHE),
        isNotNull(tasksTable.projetId),
      ))
      .orderBy(asc(tasksTable.dueDate)).limit(limite),
    db.select({ id: agentProposalsTable.id, title: agentProposalsTable.title, createdAt: agentProposalsTable.createdAt })
      .from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, orgId),
        eq(agentProposalsTable.status, "en_attente"),
        lt(agentProposalsTable.createdAt, new Date(maintenant.getTime() - (DUREE_DE_VIE_PROPOSITION_JOURS - ALERTE_EXPIRATION_JOURS) * JOUR)),
      ))
      .orderBy(asc(agentProposalsTable.createdAt)).limit(limite),
  ]);

  const simdi = rubrique([
    enLigne.map((s) => {
      const etat = (s.state ?? {}) as { callerNumber?: string; callerName?: string };
      return {
        cle: `cagri_canli:v${s.id}`, tur: s.status === "transfert" ? "cagri_aktariliyor" : "cagri_canli",
        baslik: etat.callerName || etat.callerNumber || "—", detay: etat.callerName ? etat.callerNumber ?? null : null,
        href: "/appels", sorumlu: null, zaman: iso(s.createdAt), ton: "onay" as Ton,
      };
    }),
    appelsEnCours.map((c) => ({
      cle: `cagri_canli:${c.id}`, tur: "cagri_canli", baslik: c.contactName || c.phoneNumber || "—", detay: c.contactName ? c.phoneNumber : null,
      href: `/appels/${c.id}`, sorumlu: nommer(c.createdBy, noms), zaman: iso(c.createdAt), ton: "onay" as Ton,
    })),
    rappels.map((c) => ({
      cle: `geri_arama:${c.id}`, tur: c.status === "messagerie" ? "sesli_mesaj" : "geri_arama",
      baslik: c.contactName || c.phoneNumber || "—", detay: c.contactName ? c.phoneNumber : null,
      href: `/appels/${c.id}`, sorumlu: null, zaman: iso(c.createdAt), ton: "onay" as Ton,
    })),
    demandesRappel.map((m) => ({
      cle: `geri_arama_istegi:${m.id}`, tur: "geri_arama_istegi", baslik: m.contactName || m.phoneNumber || "—",
      detay: m.content ? m.content.slice(0, 140) : null, href: "/messages", sorumlu: null, zaman: iso(m.createdAt), ton: "onay" as Ton,
    })),
    urgences.map((tache) => ({
      cle: `acil_saha:${tache.id}`, tur: "acil_saha", baslik: tache.title, detay: null,
      href: `/taches?id=${tache.id}`, sorumlu: nommer(tache.assignedTo, noms), zaman: iso(tache.dueDate), ton: "acil" as Ton,
    })),
    expirent.map((p) => ({
      cle: `onay_suresi:${p.id}`, tur: "onay_suresi", baslik: p.title, detay: null,
      href: "/file-approbation", sorumlu: null, zaman: iso(echeanceProposition(p.createdAt)), ton: "onay" as Ton,
    })),
  ]);

  // ---- Approbations -----------------------------------------------------------
  const [[{ n: totalApprobations }], propositions] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(agentProposalsTable)
      .where(and(eq(agentProposalsTable.organisationId, orgId), eq(agentProposalsTable.status, "en_attente"))),
    db.select({
      id: agentProposalsTable.id, title: agentProposalsTable.title, summary: agentProposalsTable.summary, reason: agentProposalsTable.reason,
      category: agentProposalsTable.category, sourceType: agentProposalsTable.sourceType, runId: agentProposalsTable.runId,
      createdAt: agentProposalsTable.createdAt,
    }).from(agentProposalsTable)
      .where(and(eq(agentProposalsTable.organisationId, orgId), eq(agentProposalsTable.status, "en_attente")))
      .orderBy(asc(agentProposalsTable.createdAt)).limit(limite),
  ]);
  // Qui a demande : seul le format `agent-run:<id>` mene a une personne.
  const idsExecutions = propositions.map((p) => /^agent-run:(\d+)$/.exec(p.runId)?.[1]).filter(Boolean).map(Number);
  const demandeurs = new Map<number, number | null>();
  if (idsExecutions.length) {
    for (const r of await db.select({ id: agentRunsTable.id, requestedBy: agentRunsTable.requestedBy }).from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), inArray(agentRunsTable.id, idsExecutions)))) {
      demandeurs.set(r.id, r.requestedBy);
    }
  }
  const onaylar = {
    ...rubrique([propositions.map((p) => {
      const execution = /^agent-run:(\d+)$/.exec(p.runId)?.[1];
      return {
        cle: `onay:${p.id}`, tur: `onay_${p.category || "autre"}`, baslik: p.title, detay: p.reason || p.summary || null,
        href: "/file-approbation", sorumlu: execution ? nommer(demandeurs.get(Number(execution)) ?? null, noms) : null,
        zaman: iso(echeanceProposition(p.createdAt)), ton: "onay" as Ton,
        // Source de la proposition (orchestrateur, regle, audit...) : le client la nomme.
        para: p.sourceType || undefined,
      };
    })]),
    toplam: totalApprobations ?? 0,
  };

  // ---- Plan du jour -----------------------------------------------------------
  const [rendezVous, tachesDuJour, livraisons] = await Promise.all([
    db.select({
      id: calendarEventsTable.id, title: calendarEventsTable.title, type: calendarEventsTable.type, startDate: calendarEventsTable.startDate,
      location: calendarEventsTable.location, contactName: calendarEventsTable.contactName, status: calendarEventsTable.status, createdBy: calendarEventsTable.createdBy,
    }).from(calendarEventsTable)
      .where(and(
        eq(calendarEventsTable.organisationId, orgId),
        gte(calendarEventsTable.startDate, debut),
        lt(calendarEventsTable.startDate, fin),
        sql`coalesce(${calendarEventsTable.status}, '') <> 'annule'`,
      ))
      .orderBy(asc(calendarEventsTable.startDate)).limit(limite * 2),
    db.select({ id: tasksTable.id, title: tasksTable.title, assignedTo: tasksTable.assignedTo, dueDate: tasksTable.dueDate })
      .from(tasksTable)
      .where(and(eq(tasksTable.organisationId, orgId), gte(tasksTable.dueDate, debut), lt(tasksTable.dueDate, fin), notInArray(tasksTable.status, TERMINE_TACHE)))
      .orderBy(asc(tasksTable.dueDate)).limit(limite),
    db.select({ id: projetsTable.id, title: projetsTable.title, assignedTo: projetsTable.assignedTo, endDate: projetsTable.endDate, clientName: projetsTable.clientName })
      .from(projetsTable)
      .where(and(eq(projetsTable.organisationId, orgId), gte(projetsTable.endDate, maintenant), lte(projetsTable.endDate, dans7j), notInArray(projetsTable.status, TERMINE_PROJET)))
      .orderBy(asc(projetsTable.endDate)).limit(limite),
  ]);
  // Une visite (keşif) n'est pas un rendez-vous comme un autre : elle a sa
  // ligne a elle. Un rendez-vous propose par l'IA et non confirme le dit.
  const visites = rendezVous.filter((e) => e.type === "visite");
  const autres = rendezVous.filter((e) => e.type !== "visite");
  const ligneEvenement = (e: (typeof rendezVous)[number]): Satir => ({
    cle: `${e.type === "visite" ? "kesif" : "randevu"}:${e.id}`,
    tur: e.status === "en_attente" ? "randevu_onaysiz" : e.type === "visite" ? "kesif" : "randevu",
    baslik: e.title, detay: [e.contactName, e.location].filter(Boolean).join(" · ") || null,
    href: `/calendrier?id=${e.id}`, sorumlu: nommer(e.createdBy, noms), zaman: iso(e.startDate),
    ton: e.status === "en_attente" ? "onay" : "bilgi",
  });
  const plan = rubrique([
    visites.map(ligneEvenement),
    autres.map(ligneEvenement),
    tachesDuJour.map((tache) => ({
      cle: `gorev:${tache.id}`, tur: "gorev_bugun", baslik: tache.title, detay: null, href: `/taches?id=${tache.id}`,
      sorumlu: nommer(tache.assignedTo, noms), zaman: iso(tache.dueDate), ton: "bilgi" as Ton,
    })),
    livraisons.map((p) => ({
      cle: `teslim:${p.id}`, tur: "teslim", baslik: p.title, detay: p.clientName, href: "/projets",
      sorumlu: nommer(p.assignedTo, noms), zaman: iso(p.endDate), ton: "bilgi" as Ton,
    })),
  ]);

  // ---- Dossiers -----------------------------------------------------------------
  const [nouvelles, devisEnvoyes, enRetard] = await Promise.all([
    db.select({ id: prospectsTable.id, title: prospectsTable.title, contactName: prospectsTable.contactName, company: prospectsTable.company, assignedTo: prospectsTable.assignedTo, createdAt: prospectsTable.createdAt })
      .from(prospectsTable)
      .where(and(eq(prospectsTable.organisationId, orgId), eq(prospectsTable.stage, "nouveau"), gte(prospectsTable.createdAt, ilYa7j)))
      .orderBy(desc(prospectsTable.createdAt)).limit(limite),
    db.select({
      id: devisTable.id, reference: devisTable.reference, title: devisTable.title, clientName: devisTable.clientName, validUntil: devisTable.validUntil,
      totalAmount: devisTable.totalAmount, currency: devisTable.currency, responsable: prospectsTable.assignedTo,
    }).from(devisTable)
      .leftJoin(prospectsTable, and(eq(prospectsTable.id, devisTable.prospectId), eq(prospectsTable.organisationId, orgId)))
      .where(and(eq(devisTable.organisationId, orgId), eq(devisTable.status, "envoye")))
      .orderBy(asc(devisTable.validUntil)).limit(limite),
    db.select({ id: projetsTable.id, title: projetsTable.title, assignedTo: projetsTable.assignedTo, endDate: projetsTable.endDate, clientName: projetsTable.clientName })
      .from(projetsTable)
      .where(and(eq(projetsTable.organisationId, orgId), isNotNull(projetsTable.endDate), lt(projetsTable.endDate, maintenant), notInArray(projetsTable.status, TERMINE_PROJET)))
      .orderBy(asc(projetsTable.endDate)).limit(limite),
  ]);
  const dosyalar = rubrique([
    nouvelles.map((p) => ({
      cle: `talep:${p.id}`, tur: "talep_yeni", baslik: p.title, detay: [p.contactName, p.company].filter(Boolean).join(" · ") || null,
      href: `/prospects/${p.id}`, sorumlu: nommer(p.assignedTo, noms), zaman: iso(p.createdAt), ton: "bilgi" as Ton,
    })),
    devisEnvoyes.map((d) => ({
      cle: `teklif:${d.id}`, tur: "teklif_bekliyor", baslik: `${d.reference} — ${d.title}`, detay: d.clientName,
      href: "/devis", sorumlu: nommer(d.responsable, noms), zaman: iso(d.validUntil), ton: "bilgi" as Ton,
      tutar: nombre(d.totalAmount), para: d.currency ?? "EUR",
    })),
    enRetard.map((p) => ({
      cle: `santiye_gecikti:${p.id}`, tur: "santiye_gecikti", baslik: p.title, detay: p.clientName, href: "/projets",
      sorumlu: nommer(p.assignedTo, noms), zaman: iso(p.endDate), ton: "acil" as Ton,
    })),
  ]);

  // ---- Finances ---------------------------------------------------------------
  const [echues, depassements, nonFactures] = await Promise.all([
    db.select({
      id: facturesClientTable.id, reference: facturesClientTable.reference, clientName: facturesClientTable.clientName, dueDate: facturesClientTable.dueDate,
      reste: sql<string>`${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)`, currency: facturesClientTable.currency,
    }).from(facturesClientTable)
      .where(and(eq(facturesClientTable.organisationId, orgId), overdueCondition(maintenant)))
      .orderBy(asc(facturesClientTable.dueDate)).limit(limite),
    // `spent` est saisi a la main sur le chantier (aucune depense n'y est
    // rattachee aujourd'hui) : la ligne le dit, elle ne le fait pas passer
    // pour un calcul.
    db.select({ id: projetsTable.id, title: projetsTable.title, budget: projetsTable.budget, spent: projetsTable.spent, currency: projetsTable.currency, assignedTo: projetsTable.assignedTo })
      .from(projetsTable)
      .where(and(
        eq(projetsTable.organisationId, orgId),
        sql`coalesce(${projetsTable.budget}::numeric, 0) > 0`,
        sql`coalesce(${projetsTable.spent}::numeric, 0) > ${projetsTable.budget}::numeric`,
        notInArray(projetsTable.status, ["annule"]),
      ))
      .limit(limite),
    db.select({ id: devisTable.id, reference: devisTable.reference, title: devisTable.title, clientName: devisTable.clientName, totalAmount: devisTable.totalAmount, currency: devisTable.currency, acceptedAt: devisTable.acceptedAt, acceptedBy: devisTable.acceptedBy })
      .from(devisTable)
      .where(and(eq(devisTable.organisationId, orgId), eq(devisTable.status, "accepte"), isNull(devisTable.convertedToInvoice)))
      .orderBy(asc(devisTable.acceptedAt)).limit(limite),
  ]);
  const finans = rubrique([
    echues.map((f) => ({
      cle: `fatura_gecikti:${f.id}`, tur: "fatura_gecikti", baslik: f.reference, detay: f.clientName, href: "/factures",
      sorumlu: null, zaman: iso(f.dueDate), ton: "acil" as Ton, tutar: nombre(f.reste), para: f.currency ?? "EUR",
    })),
    depassements.map((p) => ({
      cle: `butce_asimi:${p.id}`, tur: "butce_asimi", baslik: p.title, detay: "manuel", href: "/projets",
      sorumlu: nommer(p.assignedTo, noms), zaman: null, ton: "acil" as Ton, tutar: nombre(p.spent) - nombre(p.budget), para: p.currency ?? "EUR",
    })),
    nonFactures.map((d) => ({
      cle: `faturasiz_kabul:${d.id}`, tur: "faturasiz_kabul", baslik: `${d.reference} — ${d.title}`, detay: d.clientName, href: "/devis",
      sorumlu: nommer(d.acceptedBy, noms), zaman: iso(d.acceptedAt), ton: "onay" as Ton, tutar: nombre(d.totalAmount), para: d.currency ?? "EUR",
    })),
  ]);

  // ---- Agents -------------------------------------------------------------------
  const [comptes, recentes, lignes, jetonsGoogle] = await Promise.all([
    db.select({ status: agentRunsTable.status, n: sql<number>`count(*)::int` }).from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), gte(agentRunsTable.startedAt, ilYa24h)))
      .groupBy(agentRunsTable.status),
    db.select({ id: agentRunsTable.id, agentId: agentRunsTable.agentId, status: agentRunsTable.status, error: agentRunsTable.error, startedAt: agentRunsTable.startedAt, requestedBy: agentRunsTable.requestedBy })
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), gte(agentRunsTable.startedAt, ilYa24h), inArray(agentRunsTable.status, ["en_cours", "en_attente", "echouee"])))
      .orderBy(desc(agentRunsTable.startedAt)).limit(limite * 3),
    db.select({ n: sql<number>`count(*)::int` }).from(telephonyProvidersTable)
      .where(and(eq(telephonyProvidersTable.organisationId, orgId), eq(telephonyProvidersTable.isActive, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(googleOAuthTokensTable).where(eq(googleOAuthTokensTable.organisationId, orgId)),
  ]);
  const compte = (s: string) => comptes.find((c) => c.status === s)?.n ?? 0;
  const ligneExecution = (tur: string, ton: Ton) => (r: (typeof recentes)[number]): Satir => ({
    cle: `${tur}:${r.id}`, tur, baslik: r.agentId, detay: r.status === "echouee" ? (r.error ?? "").slice(0, 200) || null : null,
    href: `/bureau-taches?statut=${r.status}`, sorumlu: nommer(r.requestedBy, noms), zaman: iso(r.startedAt), ton,
  });
  const connexions: Satir[] = [];
  if ((lignes[0]?.n ?? 0) === 0) connexions.push({ cle: "baglanti_eksik:telefon", tur: "baglanti_telefon", baslik: "telephony", detay: null, href: "/telephonie", sorumlu: null, zaman: null, ton: "acil" });
  if ((jetonsGoogle[0]?.n ?? 0) === 0) connexions.push({ cle: "baglanti_eksik:google", tur: "baglanti_google", baslik: "google", detay: null, href: "/google-workspace", sorumlu: null, zaman: null, ton: "acil" });
  if (!iaDisponible()) connexions.push({ cle: "baglanti_eksik:ia", tur: "baglanti_ia", baslik: "ia", detay: null, href: "/parametres?tab=cles-ia", sorumlu: null, zaman: null, ton: "acil" });
  const ajanlar = {
    ...rubrique([
      recentes.filter((r) => r.status === "echouee").map(ligneExecution("ajan_hata", "acil")),
      recentes.filter((r) => r.status === "en_attente").map(ligneExecution("ajan_devretti", "onay")),
      recentes.filter((r) => r.status === "en_cours").map(ligneExecution("ajan_calisiyor", "bilgi")),
      connexions,
    ]),
    sayac: { calisiyor: compte("en_cours"), bekliyor: compte("en_attente"), hata: compte("echouee") },
  };

  return { simdi, onaylar, plan, dosyalar, finans, ajanlar, uretildi: maintenant.toISOString() };
}
