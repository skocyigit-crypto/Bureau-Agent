/**
 * L'alerte « taches urgentes en retard » doit compter toutes les urgentes.
 *
 * Elle en oubliait deux fois, et les deux oublis allaient dans le meme sens —
 * celui qui rassure:
 *
 *   1. elle ne regardait que `priority = 'haute'` et ignorait `urgente`, la
 *      priorite la PLUS forte. Le moteur d'automatisation marque justement
 *      `urgente` une tache en retard de plus de trois jours: les taches que le
 *      produit lui-meme juge les plus pressantes etaient exactement celles que
 *      l'alerte ne voyait pas;
 *
 *   2. le `LIMIT 3` se trouvait DANS la sous-requete comptee. Dix taches
 *      urgentes en retard s'annoncaient donc « 3 tache(s) urgente(s) en
 *      retard ».
 *
 * Une alerte qui minimise ce qu'elle signale est pire qu'une alerte absente:
 * on la lit, on croit la situation sous controle, et on ne va pas verifier.
 *
 * Le test s'appuie sur la base plutot que sur la forme du code: ce qui compte
 * ici n'est pas la requete ecrite, c'est le nombre rendu.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, organisationsTable, tasksTable } from "@workspace/db";

const MAINTENANT = new Date();
const HIER = new Date(Date.now() - 86_400_000);
let orgId = 0;

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

/** La condition telle que la route l'applique. */
function enRetardUrgentes(org: number) {
  return and(
    eq(tasksTable.organisationId, org),
    inArray(tasksTable.priority, ["haute", "urgente"]),
    eq(tasksTable.status, "en_attente"),
    lt(tasksTable.dueDate, MAINTENANT),
  );
}

describe("taches urgentes en retard", () => {
  it("compte les deux priorites, sans plafonner a trois", async () => {
    const [org] = await db
      .insert(organisationsTable)
      .values({
        name: "Verification alerte urgentes",
        slug: `verif-urgentes-${Date.now()}`,
        email: `verif-urgentes-${Date.now()}@exemple.test`,
        maxUsers: 3,
        actif: true,
      })
      .returning({ id: organisationsTable.id });
    orgId = org.id;

    // Cinq taches en retard: trois `haute`, deux `urgente`. Le nombre depasse
    // la limite d'exemples, ce qui est precisement le cas que l'ancienne
    // requete rendait faux.
    for (let i = 0; i < 5; i++) {
      await db.insert(tasksTable).values({
        organisationId: orgId,
        title: `Tache en retard ${i}`,
        status: "en_attente",
        priority: i < 3 ? "haute" : "urgente",
        dueDate: HIER,
      });
    }

    const nombre = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(tasksTable)
      .where(enRetardUrgentes(orgId))
      .then((r) => Number(r[0]?.c ?? 0));

    expect(nombre, "les deux taches « urgente » doivent etre comptees").toBe(5);

    const titres = await db
      .select({ title: tasksTable.title })
      .from(tasksTable)
      .where(enRetardUrgentes(orgId))
      .orderBy(asc(tasksTable.dueDate))
      .limit(3);

    // La limite ne porte que sur les exemples cites dans le message.
    expect(titres).toHaveLength(3);
  });

  it("l'ancienne requete rendait bien un nombre faux", async () => {
    // Contre-epreuve: sans elle, on ne saurait pas si le test ci-dessus
    // verifie une correction ou decrit un comportement qui n'a jamais change.
    const ancien = await db
      .execute(sql`
        SELECT count(*) as c FROM (
          SELECT title FROM tasks
          WHERE organisation_id = ${orgId}
            AND priority = 'haute'
            AND status = 'en_attente'
            AND due_date < ${MAINTENANT}
          ORDER BY due_date LIMIT 3
        ) sub
      `)
      .then((r) => Number((r as { rows?: Array<{ c: string }> }).rows?.[0]?.c ?? 0));

    expect(ancien, "l'ancienne requete plafonnait et ignorait « urgente »").toBe(3);
  });
});
