/**
 * cloture-cron.ts — clore les journees, sans attendre que quelqu'un y pense.
 *
 * La condition de conservation du 3° bis du I de l'article 286 du CGI n'est pas
 * « le logiciel PEUT clore »: c'est « le logiciel calcule et enregistre des
 * donnees cumulatives lors des clotures journalieres, mensuelles et
 * annuelles ». Une route de cloture que personne n'appelle ne satisfait rien —
 * et compter sur un artisan pour cliquer chaque soir n'est pas un dispositif,
 * c'est un espoir.
 *
 * Ce que fait cette tache: pour chaque organisation ayant des reglements, elle
 * clot les periodes ECHUES qui ne le sont pas encore.
 *
 * Trois choix qui evitent les pieges habituels:
 *
 *   - on ne clot JAMAIS la periode en cours. Clore aujourd'hui interdirait
 *     d'enregistrer un encaissement de cet apres-midi — le refus d'anti-datation
 *     se retournerait contre l'utilisateur;
 *
 *   - on rattrape les periodes MANQUEES. Une instance eteinte tout un week-end
 *     laisserait autrement deux journees sans cloture, et une journee sans
 *     cloture est indistinguable d'une journee effacee;
 *
 *   - la cloture est IDEMPOTENTE: la contrainte d'unicite en base fait foi, pas
 *     une verification prealable. Deux instances Cloud Run peuvent lancer la
 *     tache a la meme seconde.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, cloturesComptablesTable, encaissementsTable } from "@workspace/db";

import { logger } from "../lib/logger";
import { withHeartbeat } from "./health-agents";
import { calculerCloture, periodeDe, type ClotureScellee, type TypeCloture } from "./cloture-comptable";
import type { EcritureChainee } from "./chainage-encaissements";

/** Toutes les six heures: une journee echue est close au plus tard le lendemain matin. */
const INTERVALLE_MS = 6 * 60 * 60 * 1000;

/**
 * Nombre de periodes rattrapees au maximum par passage et par organisation.
 *
 * Borne volontaire: un journal ancien jamais clos produirait des milliers de
 * clotures en une fois, et la tache n'a pas a bloquer le processus pour
 * rattraper trois ans d'un coup. Les passages suivants termineront.
 */
const MAX_RATTRAPAGE = 60;

let timer: ReturnType<typeof setInterval> | null = null;

function enEcritures(lignes: (typeof encaissementsTable.$inferSelect)[]): EcritureChainee[] {
  return lignes.map((l) => ({
    numero: l.numero,
    organisationId: l.organisationId,
    factureId: l.factureId,
    montantCentimes: l.montantCentimes,
    devise: l.devise,
    moyen: l.moyen,
    dateEncaissement: l.dateEncaissement.toISOString(),
    sens: l.sens as "encaissement" | "annulation",
    annuleNumero: l.annuleNumero,
    empreintePrecedente: l.empreintePrecedente,
    empreinte: l.empreinte,
  }));
}

function enCloture(c: typeof cloturesComptablesTable.$inferSelect): ClotureScellee {
  return {
    organisationId: c.organisationId,
    type: c.type as TypeCloture,
    periode: c.periode,
    premierNumero: c.premierNumero,
    dernierNumero: c.dernierNumero,
    nbEcritures: c.nbEcritures,
    totalPeriodeCentimes: c.totalPeriodeCentimes,
    totalCumuleCentimes: c.totalCumuleCentimes,
    empreintePrecedente: c.empreintePrecedente,
    empreinte: c.empreinte,
  };
}

/**
 * Les periodes echues d'un type, entre la premiere ecriture et hier inclus.
 *
 * Le decoupage se fait sur la chaine ISO, comme partout ailleurs: le fuseau de
 * la machine qui calcule ne doit pas decider a quel jour appartient un
 * encaissement.
 */
export function periodesAClore(
  premiereEcritureIso: string,
  maintenant: Date,
  type: TypeCloture,
  dejaCloses: Set<string>,
): string[] {
  const out: string[] = [];
  const limite = periodeDe(maintenant.toISOString(), type); // periode EN COURS: exclue

  if (type === "journaliere") {
    const curseur = new Date(premiereEcritureIso.slice(0, 10) + "T12:00:00.000Z");
    while (out.length < MAX_RATTRAPAGE) {
      const p = curseur.toISOString().slice(0, 10);
      if (p >= limite) break;
      if (!dejaCloses.has(p)) out.push(p);
      curseur.setUTCDate(curseur.getUTCDate() + 1);
    }
    return out;
  }

  if (type === "mensuelle") {
    let annee = Number(premiereEcritureIso.slice(0, 4));
    let mois = Number(premiereEcritureIso.slice(5, 7));
    while (out.length < MAX_RATTRAPAGE) {
      const p = `${annee}-${String(mois).padStart(2, "0")}`;
      if (p >= limite) break;
      if (!dejaCloses.has(p)) out.push(p);
      mois += 1;
      if (mois > 12) { mois = 1; annee += 1; }
    }
    return out;
  }

  let annee = Number(premiereEcritureIso.slice(0, 4));
  while (out.length < MAX_RATTRAPAGE) {
    const p = String(annee);
    if (p >= limite) break;
    if (!dejaCloses.has(p)) out.push(p);
    annee += 1;
  }
  return out;
}

async function cloturerOrganisation(orgId: number, maintenant: Date): Promise<number> {
  const lignes = await db.select().from(encaissementsTable)
    .where(eq(encaissementsTable.organisationId, orgId))
    .orderBy(encaissementsTable.numero);
  if (lignes.length === 0) return 0;

  const ecritures = enEcritures(lignes);
  // La plus ancienne DATE d'encaissement, qui n'est pas forcement la premiere
  // ecriture: un reglement peut etre saisi apres un autre plus recent.
  const premiere = ecritures
    .map((e) => e.dateEncaissement)
    .reduce((a, b) => (a < b ? a : b));

  let faites = 0;

  for (const type of ["journaliere", "mensuelle", "annuelle"] as TypeCloture[]) {
    const existantes = await db.select().from(cloturesComptablesTable)
      .where(and(eq(cloturesComptablesTable.organisationId, orgId), eq(cloturesComptablesTable.type, type)));
    const dejaCloses = new Set(existantes.map((c) => c.periode));

    for (const periode of periodesAClore(premiere, maintenant, type, dejaCloses)) {
      const [precedente] = await db.select().from(cloturesComptablesTable)
        .where(and(eq(cloturesComptablesTable.organisationId, orgId), eq(cloturesComptablesTable.type, type)))
        .orderBy(desc(cloturesComptablesTable.periode)).limit(1);

      const cloture = calculerCloture(orgId, type, periode, ecritures, precedente ? enCloture(precedente) : null);

      try {
        await db.insert(cloturesComptablesTable).values({
          organisationId: cloture.organisationId,
          type: cloture.type,
          periode: cloture.periode,
          premierNumero: cloture.premierNumero,
          dernierNumero: cloture.dernierNumero,
          nbEcritures: cloture.nbEcritures,
          totalPeriodeCentimes: cloture.totalPeriodeCentimes,
          totalCumuleCentimes: cloture.totalCumuleCentimes,
          empreintePrecedente: cloture.empreintePrecedente,
          empreinte: cloture.empreinte,
          clotureePar: null,
        });
        faites += 1;
      } catch (err: any) {
        // 23505 = violation d'unicite: une autre instance vient de clore la
        // meme periode. Ce n'est pas une erreur, c'est le resultat voulu.
        if (err?.cause?.code === "23505" || err?.code === "23505") continue;
        throw err;
      }
    }
  }

  return faites;
}

async function tick() {
  try {
    // Seules les organisations ayant des reglements: clore le vide n'apporte
    // rien et ferait grossir la table pour tous les comptes d'essai.
    const orgs = await db
      .selectDistinct({ id: encaissementsTable.organisationId })
      .from(encaissementsTable);

    let total = 0;
    for (const { id } of orgs) {
      try {
        total += await cloturerOrganisation(id, new Date());
      } catch (err) {
        // Une organisation qui echoue ne doit pas priver les autres de leurs
        // clotures: la conservation est une obligation individuelle.
        logger.error({ err, orgId: id }, "[cloture] echec de cloture pour une organisation");
      }
    }
    if (total > 0) logger.info({ total, organisations: orgs.length }, "[cloture] periodes closes");
  } catch (err) {
    logger.error({ err }, "[cloture] echec du passage");
  }
}

export function startClotureCron() {
  if (timer) return;
  logger.info("[cloture] tache de cloture comptable demarree");
  void tick();
  // `withHeartbeat` inscrit la tache au registre lu par /api/cron/tick: avec
  // min-instances=0, un `setInterval` seul ne tourne que tant qu'une instance
  // reste eveillee par du trafic — et une obligation legale ne peut pas
  // dependre de la presence d'un visiteur.
  timer = setInterval(withHeartbeat("cloture-comptable", INTERVALLE_MS, tick), INTERVALLE_MS);
}

export function stopClotureCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
