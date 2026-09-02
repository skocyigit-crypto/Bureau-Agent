/**
 * Lecture des nombres venant de l'URL: identifiants, pagination, limites.
 *
 * Pourquoi ce module existe, et pourquoi il est si petit. La question de depart
 * etait « 654 routes, 60 schemas de validation »: la validation d'entree
 * paraissait mince. En mesurant, elle ne l'est pas la ou on l'attendait — le
 * depot n'ecrit jamais `req.body` en bloc, il choisit ses champs un par un, et
 * l'affectation de masse n'existe nulle part. Ajouter un schema sur chaque
 * route aurait donc surtout ajoute du code.
 *
 * Ce qui manque vraiment est plus etroit, et mesure: les nombres pris dans
 * l'URL sans garde.
 *
 *  - `parseInt(String(req.params.id))` sur une URL non numerique rend `NaN`.
 *    Il part tel quel dans `eq(table.id, NaN)`, Postgres refuse, et le client
 *    recoit une **erreur 500**. Une faute de frappe dans une URL devient une
 *    panne serveur — et, pire, elle pollue le taux de 5xx que l'agent de sante
 *    surveille depuis peu: le bruit ronge l'alarme qu'on vient d'installer.
 *
 *  - `parseInt(String(req.query.limit || "50"))` sans plafond laisse
 *    `?limit=99999999` demander toute la table d'une organisation en une
 *    requete, et `?limit=abc` produire `LIMIT NaN`.
 *
 * `audit.ts` avait deja la bonne fonction, en local. La voici partagee: le
 * defaut n'etait pas l'ignorance du bon geste, seulement qu'il n'etait pas a
 * portee de main.
 */

/** Entier borne, avec repli. Une valeur absente ou illisible vaut le defaut. */
export function safeInt(value: unknown, defaultValue: number, min: number, max: number): number {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < min) return defaultValue;
  return Math.min(n, max);
}

/**
 * Identifiant de ligne pris dans l'URL, ou `null` si ce n'en est pas un.
 *
 * `null` et non `NaN`: la difference tient tout l'interet du module. `NaN`
 * traverse le code sans bruit jusqu'a la base, qui repond par une erreur; un
 * `null` oblige l'appelant a decider, et la bonne decision est un 400, pas un
 * 500.
 */
export function rowId(value: unknown): number | null {
  // Chiffres, et rien d'autre — plutot que `parseInt`, qui est trop
  // accommodant pour un identifiant. Deux cas l'ont montre en test:
  //
  //  - `?id=1&id=2` arrive dans Express sous forme de tableau. `String(...)`
  //    en fait `"1,2"` et `parseInt` y lit 1, sans rien signaler: la requete
  //    porterait sur une ligne que l'appelant n'a pas demandee.
  //  - `"1.5"` donnait 1, et `"12abc"` donnait 12. Un identifiant devine est
  //    pire qu'un identifiant refuse.
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  // Les cles primaires sont des `serial`: strictement positives, jamais 0, et
  // bornees par ce qu'un entier JavaScript represente exactement.
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/** Plafond de pagination applique par defaut aux listes. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Limite de liste demandee par le client, toujours bornee. */
export function pageLimit(value: unknown, max = MAX_PAGE_SIZE): number {
  return safeInt(value, DEFAULT_PAGE_SIZE, 1, max);
}
