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

describe("la sonde ne lave pas une panne qu'elle n'a pas reproduite", () => {
  it("un succes de sonde n'efface pas l'echec du trafic reel", async () => {
    // LE DEFAUT, MESURE APRES UNE PREMIERE CORRECTION INSUFFISANTE.
    //
    // Rendre l'observation partagee ne suffisait pas: l'agent de sante SONDE
    // juste avant de lire. La sonde demande quatre jetons de sortie et passe
    // sur un compte sans credit qui refuse tout appel utile — le 15/09, zero
    // sonde en echec pour seize bascules reelles. Traitee comme un succes,
    // elle effacait le compteur d'echecs quatre secondes avant la lecture: la
    // supervision detruisait la preuve qu'elle allait rapporter.
    enregistrerObservation(FOURNISSEUR, false, "429 credits depleted", 3);
    await laisserEcrire();

    enregistrerObservation(FOURNISSEUR, true, null, 0, "sonde");
    await new Promise((r) => setTimeout(r, 250));

    const ligne = await lireLigne();
    expect(ligne.lastFailureAt, "l'echec reel a ete efface par une sonde").toBeTruthy();
    expect(ligne.lastSuccessAt, "une sonde a ete comptee comme un appel reussi").toBeNull();
    expect(ligne.failures, "le compteur d'echecs a ete remis a zero par une sonde").toBe(3);
    expect(ligne.lastReason).toContain("credits");
  });

  it("elle laisse tout de meme un signe de vie", async () => {
    // Sans cela, la sonde ne servirait plus a rien: un recours jamais appele
    // resonderait a chaque cycle, et « jamais vu » resterait indiscernable de
    // « vu et muet ».
    enregistrerObservation(FOURNISSEUR, true, null, 0, "sonde");
    await laisserEcrire();
    const ligne = await lireLigne();
    expect(ligne.lastProbeSuccessAt).toBeTruthy();
  });

  it("un vrai succes, lui, lave la panne", async () => {
    // La symetrie compte: seul un appel UTILE prouve qu'un fournisseur sert.
    enregistrerObservation(FOURNISSEUR, false, "429 credits depleted", 3);
    await laisserEcrire();
    enregistrerObservation(FOURNISSEUR, true, null, 0, "trafic");
    await new Promise((r) => setTimeout(r, 250));

    const ligne = await lireLigne();
    expect(ligne.lastSuccessAt).toBeTruthy();
    expect(ligne.failures).toBe(0);
    expect(ligne.lastReason).toBeNull();
  });

  it("un echec de sonde compte comme un echec reel", async () => {
    // L'invite de la sonde est fixe et connue pour valide: si elle echoue, la
    // cause est du cote du fournisseur, quelle qu'elle soit.
    //
    // La ligne existe DEJA quand l'echec arrive, et ce detail est le test.
    // Une premiere version partait d'une table vide: le chemin `INSERT`
    // remplissait `lastFailureAt` a partir du seul booleen, si bien qu'un
    // mutant confondant a nouveau sonde et trafic restait invisible. C'est le
    // chemin `ON CONFLICT` qui porte la regle, donc c'est lui qu'il faut
    // emprunter.
    enregistrerObservation(FOURNISSEUR, true, null, 0, "sonde");
    await laisserEcrire();

    enregistrerObservation(FOURNISSEUR, false, "sonde: 503", 1, "sonde");
    await new Promise((r) => setTimeout(r, 250));

    const ligne = await lireLigne();
    expect(ligne.lastFailureAt, "un echec de sonde a ete traite comme un signe de vie").toBeTruthy();
    expect(ligne.failures).toBe(1);
    expect(ligne.lastReason).toContain("503");
  });
});

describe("l'ecriture peut etre ATTENDUE", () => {
  // POURQUOI CE GROUPE EXISTE
  //
  // Cloud Run n'alloue du CPU que pendant le traitement d'une requete
  // (`cpu-throttling=true`, verifie sur le service). Une ecriture lancee sans
  // etre attendue se planifie pendant la requete et s'execute APRES la
  // reponse — c'est-a-dire au moment precis ou l'instance est gelee. La
  // promesse ne se resout jamais: ni ligne ecrite, ni `catch` declenche, ni
  // journal.
  //
  // C'est ce qui a rendu ce module inoperant en production sans produire la
  // moindre erreur, et ce que trois deploiements ont cherche ailleurs. Le
  // meme piege est deja documente dans `health-agents-cron.ts`, qui a renonce
  // a son minuteur interne pour cette raison exacte.
  //
  // En test, rien ne gele: un `void` passerait inapercu ici aussi. Ces tests
  // verrouillent donc la SIGNATURE — une promesse est rendue, et l'appelant
  // peut l'attendre — parce que c'est la seule chose qu'un test local puisse
  // reellement prouver.

  it("rend une promesse, meme quand l'ecriture est etranglee", async () => {
    enregistrerObservation(FOURNISSEUR, false, "panne", 1);
    const seconde = enregistrerObservation(FOURNISSEUR, false, "panne", 1);
    expect(seconde, "l'etranglement rend `undefined`: impossible a attendre").toBeInstanceOf(
      Promise,
    );
    await expect(seconde).resolves.toBeUndefined();
  });

  it("la promesse n'est tenue qu'une fois la ligne ecrite", async () => {
    // Sans cela, attendre ne servirait a rien: on attendrait une promesse
    // deja resolue pendant que l'ecriture, elle, partirait a la derive.
    await enregistrerObservation(FOURNISSEUR, false, "429 credits depleted", 2);
    const ligne = await lireLigne();
    expect(
      ligne,
      "la promesse s'est resolue avant que la ligne n'existe",
    ).toBeDefined();
    expect(ligne.failures).toBe(2);
  });

  it("aucune ecriture n'est lancee sans etre rendue", async () => {
    // GARDE STATIQUE, ET ELLE EST ASSUMEE COMME TELLE.
    //
    // Mesure par mutation: en remettant `void db.insert(...)` et en rendant
    // une promesse deja resolue, les vingt-deux tests de ce fichier restent
    // VERTS. C'est normal et ce n'est pas rattrapable autrement: en test rien
    // ne gele, donc l'ecriture aboutit quand meme. Le defaut n'existe que
    // sous Cloud Run, apres la reponse.
    //
    // Un test local ne peut donc pas prouver le comportement; il peut
    // seulement interdire la FORME qui l'a cause. C'est un garde-fou plus
    // faible qu'une verification de comportement, et il vaut mieux l'ecrire
    // que de croire les autres tests suffisants.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "services", "ai-provider-observations.ts"),
      "utf8",
    );
    expect(
      /\bvoid\s+db\b/.test(source),
      "une ecriture non attendue ne s'executera jamais sous Cloud Run: " +
        "l'instance est gelee des la reponse envoyee.",
    ).toBe(false);
  });

  it("le relai d'echec passe par la meme promesse", async () => {
    // `noteFailure` rend desormais cette promesse, et les chemins de bascule
    // l'attendent. Si la signature redevenait `void`, ce test tomberait.
    const { noteProviderFailure } = await import("../services/ai-failover");
    const rendu = noteProviderFailure("gemini", "429 test");
    expect(rendu, "`noteProviderFailure` ne rend plus de promesse").toBeInstanceOf(Promise);
    await rendu;
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
