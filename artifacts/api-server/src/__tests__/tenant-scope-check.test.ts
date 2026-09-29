/**
 * Le controle d'isolation des locataires juge chaque GESTIONNAIRE, pas chaque
 * fichier.
 *
 * LE TROU QU'ON FERME : le decoupage ne reconnaissait qu'un `router.get(` en
 * colonne zero. Un gestionnaire indente — `  router.post("/calls/ai-agent-save"`
 * dans calls.ts, par exemple — etait replie dans le bloc precedent et heritait
 * de SA mention de l'organisation. Un gestionnaire sans aucun filtre pouvait
 * donc passer la porte, pourvu que son voisin du dessus en ait un. (Lecon de
 * la session BatiFlow, 29/09 : un controle par FICHIER laissait passer un
 * gestionnaire non protege du meme fichier ; ici, un bloc mal decoupe faisait
 * la meme chose a plus petite echelle.)
 *
 * On APPELLE la decision sur un texte construit, au lieu de verifier la forme
 * de l'expression reguliere : une reorganisation du script ne doit pas faire
 * tomber ce test, un retour du defaut si.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blocks, blocsSansOrganisation } from "../../scripts/tenant-scope-check.mjs";

const TABLES = new Set(["tasksTable"]);
const TABLES_SQL = new Set(["tasks"]);
const juger = (src: string) => blocsSansOrganisation(src, TABLES, TABLES_SQL);
const signales = (src: string) => juger(src).unaware.map((b) => b.name);

const PROTEGE = [
  `router.get("/taches", async (req, res) => {`,
  `  const orgId = getOrgId(req);`,
  `  res.json(await db.select().from(tasksTable).where(eq(tasksTable.organisationId, orgId)));`,
  `});`,
].join("\n");

describe("un gestionnaire indente est juge pour lui-meme", () => {
  it("indente de deux espaces sous un voisin protege : il est signale", () => {
    const src = `${PROTEGE}\n\n  router.post("/taches/purge", async (_req, res) => {\n    await db.delete(tasksTable);\n    res.json({ ok: true });\n  });\n`;
    expect(signales(src)).toEqual(["POST /taches/purge"]);
  });

  it("il forme son propre bloc au lieu d'allonger celui du dessus", () => {
    const src = `${PROTEGE}\n  router.post("/taches/purge", async () => { await db.delete(tasksTable); });\n`;
    const bs = blocks(src);
    expect(bs.map((b) => b.name)).toEqual(["GET /taches", "POST /taches/purge"]);
    expect(bs[0]!.text).not.toContain("/taches/purge");
  });

  it("indente d'une tabulation : meme verdict", () => {
    const src = `${PROTEGE}\n\trouter.delete("/taches/:id", async (req) => { await db.delete(tasksTable).where(eq(tasksTable.id, req.params.id)); });\n`;
    expect(signales(src)).toEqual(["DELETE /taches/:id"]);
  });

  it("les deux blocs comptent comme examines", () => {
    const src = `${PROTEGE}\n  router.put("/taches/:id", async () => { await db.update(tasksTable).set({ title: "x" }); });\n`;
    expect(juger(src).examined).toBe(2);
  });
});

describe("les formes d'isolation reconnues ne sont pas signalees", () => {
  it("filtre explicite sur la colonne", () => expect(signales(PROTEGE)).toEqual([]));

  it("condition pre-calculee dans le fichier", () => {
    const src = [
      `const parOrg = (id: number) => eq(tasksTable.organisationId, id);`,
      `  router.get("/x", async (req, res) => { res.json(await db.select().from(tasksTable).where(parOrg(1))); });`,
    ].join("\n");
    expect(signales(src)).toEqual([]);
  });

  it("portee par utilisateur issu de la session", () => {
    const src = `  router.get("/mes-taches", async (req, res) => { res.json(await db.select().from(tasksTable).where(eq(tasksTable.userId, req.session.userId))); });\n`;
    expect(signales(src)).toEqual([]);
  });

  it("helper de portee du depot", () => {
    const src = `  router.get("/x", async (req, res) => { res.json(await db.select().from(tasksTable).where(tenantCondition(req, tasksTable))); });\n`;
    expect(signales(src)).toEqual([]);
  });
});

describe("le reste du verdict ne bouge pas", () => {
  it("un gestionnaire en colonne zero sans filtre reste signale", () => {
    const src = `router.get("/toutes", async (_req, res) => { res.json(await db.select().from(tasksTable)); });\n`;
    expect(signales(src)).toEqual(["GET /toutes"]);
  });

  it("une fonction de premier niveau sans filtre est signalee sous son nom", () => {
    const src = `export async function toutPurger() {\n  await db.delete(tasksTable);\n}\n`;
    expect(signales(src)).toEqual(["toutPurger"]);
  });

  it("le SQL brut apres FROM compte comme table de locataire", () => {
    const src = "router.get(\"/brut\", async () => { await db.execute(sql`SELECT * FROM tasks`); });\n";
    expect(signales(src)).toEqual(["GET /brut"]);
  });

  it("un gestionnaire qui ne touche aucune table de locataire n'est pas examine", () => {
    const src = `  router.get("/sante", async (_req, res) => { res.json(await db.select().from(settingsTable)); });\n`;
    expect(juger(src)).toEqual({ examined: 0, unaware: [] });
  });
});

describe("le script lance par la CI utilise bien cette decision", () => {
  const SCRIPT = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "tenant-scope-check.mjs"), "utf8");
  // Sinon ce test mesurerait une fonction que plus personne n'appelle.
  it("l'analyse du depot passe par blocsSansOrganisation", () => {
    expect(SCRIPT).toContain("blocsSansOrganisation(src, scoped, scopedSql)");
  });
  it("le rapport ne tourne que si le script est lance (l'import ne sort pas du processus)", () => {
    expect(SCRIPT).toMatch(/if \(path\.basename\(process\.argv\[1\] \?\? ""\) === "tenant-scope-check\.mjs"\) rapport\(\);/);
  });
});
