/**
 * Partage, entre les instances, ce que chacune sait des fournisseurs d'IA.
 *
 * LE PROBLEME, MESURE
 *
 * L'etat de sante des fournisseurs vivait dans une `Map` de module — une
 * memoire par instance Cloud Run. Le service tourne jusqu'a trois instances et
 * redescend a zero: cette memoire se scinde et s'efface en permanence.
 *
 * Le 15 septembre 2026, entre 09h20 et 10h17 UTC:
 *
 *     12 bascules  gemini -> autre fournisseur, toutes sur
 *                  « 429 — prepayment credits are depleted »
 *      4 passages  de l'agent de sante pendant la meme fenetre
 *      0 sonde     en echec
 *      0 mention   de Gemini dans les constats: seul Stripe etait signale
 *
 * L'agent de sante ne mentait pas. L'instance qui le faisait tourner n'avait,
 * elle, rien vu — et `STALE_AFTER_MS` valant une heure, elle ne sondait meme
 * pas un fournisseur qu'elle croyait avoir vu recemment.
 *
 * C'est la deuxieme fois que cette cecite coute quelque chose. Le 1er
 * septembre, une panne d'OpenAI etait restee invisible une journee entiere; la
 * correction d'alors avait rendu l'observation FIDELE. Celle-ci la rend
 * PARTAGEE, ce qui etait l'autre moitie du probleme.
 *
 * CE QUE CE MODULE FAIT, ET NE FAIT PAS
 *
 * Une ligne par fournisseur, ecrasee. Ce n'est pas un journal: on ne fait pas
 * grossir une table a chaque appel d'IA. L'ecriture est etranglee (au plus une
 * par fournisseur et par `INTERVALLE_ECRITURE_MS`), SAUF quand l'etat bascule
 * de sain a en panne ou l'inverse — une transition est precisement ce qu'on ne
 * veut jamais rater.
 *
 * Rien ici ne doit pouvoir faire echouer un appel d'IA. Toute erreur de base
 * est avalee: une supervision degradee vaut mieux qu'une reponse perdue.
 */
import { db, aiProviderObservationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

import { logger } from "../lib/logger";

/** D'ou vient une observation: un appel utile, ou la sonde de disponibilite. */
export type Origine = "trafic" | "sonde";

/**
 * Dernier etat ecrit pour un fournisseur.
 *
 * `sonde-ok` est distinct de `ok` a dessein: il porte son propre etranglement,
 * si bien qu'un signe de vie n'empeche jamais l'ecriture d'un vrai succes ni
 * d'un vrai echec, et reciproquement.
 */
type EtatEcrit = "ok" | "ko" | "sonde-ok";

export interface ObservationPartagee {
  provider: string;
  lastSuccessAt: number | null;
  lastProbeSuccessAt: number | null;
  lastFailureAt: number | null;
  lastReason: string | null;
  failures: number;
}

/** Au plus une ecriture par fournisseur et par minute, hors transition. */
const INTERVALLE_ECRITURE_MS = 60 * 1000;

/** Duree de vie du cache de lecture: la supervision passe toutes les 15 min. */
const CACHE_LECTURE_MS = 15 * 1000;

const derniereEcriture = new Map<string, number>();
const dernierEtatEcrit = new Map<string, EtatEcrit>();

let cache: { a: number; lignes: ObservationPartagee[] } | null = null;

/** Remet le module a zero. Reserve aux tests. */
export function reinitialiserObservations(): void {
  derniereEcriture.clear();
  dernierEtatEcrit.clear();
  cache = null;
}

function doitEcrire(provider: string, etat: EtatEcrit): boolean {
  // Une transition passe toujours: c'est l'information, le reste est du bruit.
  if (dernierEtatEcrit.get(provider) !== etat) return true;
  const derniere = derniereEcriture.get(provider);
  return derniere === undefined || Date.now() - derniere >= INTERVALLE_ECRITURE_MS;
}

/**
 * Enregistre une observation reelle, sans jamais jeter.
 *
 * `failures` est le compteur d'echecs consecutifs tel que l'instance appelante
 * le connait. On l'ecrit tel quel plutot que de l'incrementer en base: deux
 * instances qui incrementeraient la meme ligne compteraient deux fois le meme
 * incident, et le disjoncteur se declencherait sur une panne qui n'a eu lieu
 * qu'une fois.
 */
export function enregistrerObservation(
  provider: string,
  ok: boolean,
  reason: string | null,
  failures: number,
  origine: Origine = "trafic",
): void {
  // Une sonde qui passe n'est pas un succes: c'est un signe de vie.
  //
  // Elle demande quatre jetons de sortie et passe sur un compte sans credit
  // qui refuse tout appel utile. Comme l'agent de sante sonde JUSTE AVANT de
  // lire, la traiter comme un succes revenait a effacer, quatre secondes
  // avant la lecture, la panne que la lecture devait rapporter. Mesure du
  // 15/09: quatre bascules reelles, un passage de l'agent, toujours aucun
  // constat — meme apres avoir rendu l'observation partagee.
  const sondeQuiPasse = origine === "sonde" && ok;

  const etat: "ok" | "ko" = ok ? "ok" : "ko";
  if (!sondeQuiPasse && !doitEcrire(provider, etat)) return;
  if (sondeQuiPasse && !doitEcrire(provider, "sonde-ok")) return;
  derniereEcriture.set(provider, Date.now());
  dernierEtatEcrit.set(provider, sondeQuiPasse ? "sonde-ok" : etat);
  cache = null;

  const maintenant = new Date();
  const valeurs = {
    provider,
    lastSuccessAt: ok && !sondeQuiPasse ? maintenant : null,
    lastProbeSuccessAt: sondeQuiPasse ? maintenant : null,
    lastFailureAt: ok ? null : maintenant,
    lastReason: ok ? null : (reason ?? "").slice(0, 200) || null,
    failures: ok ? 0 : failures,
  };

  void db
    .insert(aiProviderObservationsTable)
    .values(valeurs)
    .onConflictDoUpdate({
      target: aiProviderObservationsTable.provider,
      set: sondeQuiPasse
        ? {
            // Rien d'autre. Surtout pas `failures` ni `lastReason`: une sonde
            // ne lave pas une panne qu'elle n'a pas su reproduire.
            lastProbeSuccessAt: maintenant,
            updatedAt: maintenant,
          }
        : ok
          ? {
              lastSuccessAt: maintenant,
              failures: 0,
              lastReason: null,
              updatedAt: maintenant,
            }
          : {
              lastFailureAt: maintenant,
              lastReason: valeurs.lastReason,
              failures: valeurs.failures,
              updatedAt: maintenant,
            },
    })
    .catch((err: unknown) => {
      // Volontairement en `debug`: cette ecriture est un confort de
      // supervision. La signaler en erreur a chaque appel d'IA noierait les
      // journaux que l'on consulte justement pour diagnostiquer une panne.
      logger.debug(
        { err: err instanceof Error ? err.message : String(err), provider },
        "[ai-observations] ecriture de l'observation impossible",
      );
    });
}

/**
 * Ce que TOUTES les instances ont observe, la plus recente l'emportant.
 *
 * Renvoie une liste vide si la base est injoignable: l'appelant doit alors se
 * rabattre sur sa propre memoire, jamais conclure que tout va bien.
 */
export async function lireObservationsPartagees(): Promise<ObservationPartagee[]> {
  if (cache && Date.now() - cache.a < CACHE_LECTURE_MS) return cache.lignes;
  try {
    const rows = await db.select().from(aiProviderObservationsTable);
    const lignes = rows.map((r) => ({
      provider: r.provider,
      lastSuccessAt: r.lastSuccessAt ? new Date(r.lastSuccessAt).getTime() : null,
      lastProbeSuccessAt: r.lastProbeSuccessAt ? new Date(r.lastProbeSuccessAt).getTime() : null,
      lastFailureAt: r.lastFailureAt ? new Date(r.lastFailureAt).getTime() : null,
      lastReason: r.lastReason,
      failures: r.failures,
    }));
    cache = { a: Date.now(), lignes };
    return lignes;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[ai-observations] lecture des observations partagees impossible",
    );
    return [];
  }
}

/** Compte les ecritures evitees, pour les tests d'etranglement. */
export function estimationEcritures(): number {
  return derniereEcriture.size;
}

/** Expose la condition d'ecriture, pour la tester sans toucher a la base. */
export const _interne = { doitEcrire, INTERVALLE_ECRITURE_MS, CACHE_LECTURE_MS, sql };
