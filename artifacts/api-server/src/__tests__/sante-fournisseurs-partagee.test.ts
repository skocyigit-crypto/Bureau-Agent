/**
 * Une panne vue par une instance doit etre visible par toutes les autres.
 *
 * CE QUI A ETE MESURE
 *
 * Le 15 septembre 2026, entre 09h20 et 10h17 UTC, en production:
 *
 *     12 bascules  gemini -> autre fournisseur, toutes sur
 *                  « 429 — prepayment credits are depleted »
 *      4 passages  de l'agent de sante pendant la meme fenetre
 *      0 sonde     en echec
 *      0 mention   de Gemini dans les constats: seul Stripe etait signale
 *
 * L'agent de sante ne mentait pas. L'etat de sante vivait dans une `Map` de
 * module — une memoire PAR INSTANCE Cloud Run — et l'instance qui faisait
 * tourner la supervision n'avait rien vu. `STALE_AFTER_MS` valant une heure,
 * elle ne sondait meme pas un fournisseur qu'elle croyait avoir vu.
 *
 * C'etait la deuxieme occurrence de la meme cecite. Le 1er septembre, une
 * panne d'OpenAI etait restee invisible une journee entiere; la correction
 * d'alors avait rendu l'observation FIDELE. Il manquait qu'elle soit PARTAGEE.
 *
 * CE QUE CES TESTS VERROUILLENT
 *
 * Ils simulent deux instances en jouant sur l'etat partage: l'une observe
 * l'echec, l'autre lit la sante. La propriete tenue est que la seconde voie la
 * panne de la premiere — et, symetriquement, qu'un succes plus recent la
 * lave, sans quoi un fournisseur retabli resterait marque en panne pour
 * toujours.
 *
 * Le dernier groupe porte sur l'etranglement des ecritures. Ce relai est
 * traverse a CHAQUE appel d'IA: s'il ecrivait a chaque fois, la supervision
 * couterait plus cher que ce qu'elle surveille. Une transition, elle, doit
 * toujours passer — c'est precisement l'information qu'on ne veut pas rater.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, aiProviderObservationsTable } from "@workspace/db";

import {
  enregistrerObservation,
  lireObservationsPartagees,
  reinitialiserObservations,
  _interne,
} from "../services/ai-provider-observations";

const FOURNISSEUR = "fournisseur-de-test";

/** Laisse aboutir l'ecriture, qui est volontairement detachee de l'appelant. */
async function laisserEcrire(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const [ligne] = await db
      .select()
      .from(aiProviderObservationsTable)
      .where(eq(aiProviderObservationsTable.provider, FOURNISSEUR));
    if (ligne) return;
  }
}

async function lireLigne() {
  const [ligne] = await db
    .select()
    .from(aiProviderObservationsTable)
    .where(eq(aiProviderObservationsTable.provider, FOURNISSEUR));
  return ligne;
}

beforeEach(async () => {
  reinitialiserObservations();
  await db
    .delete(aiProviderObservationsTable)
    .where(eq(aiProviderObservationsTable.provider, FOURNISSEUR));
});

afterEach(async () => {
  await db
    .delete(aiProviderObservationsTable)
    .where(eq(aiProviderObservationsTable.provider, FOURNISSEUR));
  reinitialiserObservations();
});

describe("une panne observee est ecrite quelque part", () => {
  it("l'echec quitte la memoire de l'instance", async () => {
    // Sans cette ligne, l'observation meurt avec l'instance — et le 15/09,
    // c'est exactement ce qui est arrive douze fois.
    enregistrerObservation(FOURNISSEUR, false, "429 prepayment credits are depleted", 1);
    await laisserEcrire();
    const ligne = await lireLigne();
    expect(ligne, "aucune trace de l'echec hors de la memoire locale").toBeDefined();
    expect(ligne.lastFailureAt).toBeTruthy();
    expect(ligne.lastReason).toContain("credits are depleted");
  });

  it("la cause est conservee, pas seulement le fait", async () => {
    // « Gemini est en panne » n'aide personne. « Credits epuises » se corrige
    // en cinq minutes, sur une page de facturation.
    enregistrerObservation(FOURNISSEUR, false, "429 prepayment credits are depleted", 2);
    await laisserEcrire();
    const ligne = await lireLigne();
    expect(String(ligne.lastReason).length).toBeGreaterThan(10);
  });

  it("une cause demesuree est tronquee, pas rejetee", async () => {
    // Certains fournisseurs renvoient une page HTML entiere en guise
    // d'erreur. La perdre serait pire que la couper.
    enregistrerObservation(FOURNISSEUR, false, "x".repeat(5000), 1);
    await laisserEcrire();
    const ligne = await lireLigne();
    expect(ligne.lastReason).toBeTruthy();
    expect(String(ligne.lastReason).length).toBeLessThanOrEqual(200);
  });

  it("le nombre d'echecs consecutifs est partage", async () => {
    // C'est ce compteur qui declenche le disjoncteur: s'il reste local,
    // chaque instance recommence a zero et le fournisseur n'est jamais ecarte.
    enregistrerObservation(FOURNISSEUR, false, "panne", 3);
    await laisserEcrire();
    const ligne = await lireLigne();
    expect(ligne.failures).toBe(3);
  });
});

describe("une autre instance voit la panne", () => {
  it("la lecture partagee retourne l'echec ecrit par une autre", async () => {
    enregistrerObservation(FOURNISSEUR, false, "429 credits depleted", 1);
    await laisserEcrire();

    // Une instance neuve: aucune memoire locale de cet incident.
    reinitialiserObservations();

    const partagees = await lireObservationsPartagees();
    const vu = partagees.find((o) => o.provider === FOURNISSEUR);
    expect(vu, "une instance neuve ne voit pas la panne des autres").toBeDefined();
    expect(vu!.lastFailureAt).toBeTruthy();
    expect(vu!.lastSuccessAt).toBeNull();
    expect(vu!.lastReason).toContain("credits");
  });

  it("un succes posterieur lave la panne", async () => {
    // L'erreur symetrique: un fournisseur retabli qui resterait marque en
    // panne ferait basculer le trafic pour rien, indefiniment.
    enregistrerObservation(FOURNISSEUR, false, "panne", 1);
    await laisserEcrire();
    enregistrerObservation(FOURNISSEUR, true, null, 0);
    await new Promise((r) => setTimeout(r, 200));

    const ligne = await lireLigne();
    expect(ligne.lastSuccessAt).toBeTruthy();
    expect(ligne.failures).toBe(0);
    expect(ligne.lastReason).toBeNull();
  });

  it("la lecture ne fabrique pas d'etat sain quand elle ne sait rien", async () => {
    // Le piege du 1er septembre: « aucune observation » se lisait comme
    // « tout va bien ». Une absence doit rester une absence.
    const partagees = await lireObservationsPartagees();
    expect(partagees.find((o) => o.provider === FOURNISSEUR)).toBeUndefined();
  });
});

describe("l'ecriture est etranglee", () => {
  it("deux echecs d'affilee n'ecrivent qu'une fois", () => {
    // Ce relai est traverse a chaque appel d'IA. Sans etranglement, la
    // supervision couterait plus cher que ce qu'elle surveille.
    expect(_interne.doitEcrire(FOURNISSEUR, "ko")).toBe(true);
    enregistrerObservation(FOURNISSEUR, false, "panne", 1);
    expect(_interne.doitEcrire(FOURNISSEUR, "ko")).toBe(false);
  });

  it("une transition passe toujours", () => {
    // La transition est l'information; le reste est de la repetition.
    enregistrerObservation(FOURNISSEUR, false, "panne", 1);
    expect(_interne.doitEcrire(FOURNISSEUR, "ko")).toBe(false);
    expect(
      _interne.doitEcrire(FOURNISSEUR, "ok"),
      "le retablissement d'un fournisseur ne doit jamais etre etrangle",
    ).toBe(true);
  });

  it("l'intervalle reste court devant la cadence de supervision", () => {
    // L'agent de sante passe toutes les 15 minutes. Un etranglement du meme
    // ordre rendrait l'etat partage perpetuellement en retard d'un cycle.
    expect(_interne.INTERVALLE_ECRITURE_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(_interne.CACHE_LECTURE_MS).toBeLessThan(_interne.INTERVALLE_ECRITURE_MS);
  });

  it("une base injoignable ne fait pas echouer l'appel d'IA", () => {
    // Une supervision degradee vaut mieux qu'une reponse perdue. Aucun
    // `await`, aucune exception: l'appelant ne doit meme pas savoir qu'une
    // ecriture a lieu.
    expect(() =>
      enregistrerObservation(FOURNISSEUR, false, "panne", 1),
    ).not.toThrow();
  });
});
