/**
 * Ferme le pool de connexions a la fin de CHAQUE fichier de test.
 *
 * Sans ceci, la suite tombait en integration continue sur un « sorry, too
 * many clients already » — une erreur qui designe Postgres et fait donc
 * chercher au mauvais endroit. La cause est ici:
 *
 *   - `pool: "forks"` avec `singleFork` execute tous les fichiers dans UN
 *     processus, mais vitest isole quand meme les modules: chaque fichier
 *     reimporte `@workspace/db`, donc CONSTRUIT UN NOUVEAU POOL;
 *   - aucun de ces pools ne se refermait. Une vingtaine de fichiers touchent
 *     la base, a huit connexions chacun: le total depasse le `max_connections`
 *     de la base ephemere bien avant le dernier fichier.
 *
 * Le defaut n'est donc jamais dans le test qui echoue: c'est celui qui passe
 * le seuil qui rougit, et il change au gre de l'ordre d'execution. C'est ce
 * qui rendait le diagnostic trompeur — on a d'abord reduit le nombre de
 * requetes simultanees d'UN test (#110), ce qui repoussait le seuil sans le
 * supprimer.
 *
 * Fermer apres chaque fichier rend la consommation bornee par fichier et non
 * plus cumulative.
 */
import { afterAll } from "vitest";

import { closePool } from "@workspace/db";

afterAll(async () => {
  await closePool();
});
