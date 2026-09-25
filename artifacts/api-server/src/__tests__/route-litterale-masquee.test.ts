/**
 * Une route litterale declaree APRES une route a parametre est morte.
 *
 * Express sert la PREMIERE route qui correspond. `/documents/:id` declaree
 * avant `/documents/by-source` capture « by-source » comme un identifiant :
 * le handler repond « ID invalide » en 400, sur un ecran ou personne n'a
 * saisi d'identifiant. La route litterale n'est jamais atteinte, et rien ne
 * le signale — ni au demarrage, ni a la compilation.
 *
 * Ici, le garde existe : `/documents/:id` rend la main par `next()` quand le
 * segment n'est pas numerique. Ce fichier ne repare donc rien. Il ferme la
 * porte : 666 routes sont declarees dans ce depot, et la regle d'ordre n'est
 * visible nulle part. Le jour ou quelqu'un ajoute `/documents/archives` sous
 * `/documents/:id`, c'est ce controle qui doit parler, pas un client.
 *
 * DEUX CONTROLES, ET PAS UN SEUL, parce qu'ils ne croient pas la meme chose :
 *
 *   1. un releve de la SOURCE, qui trouve les collisions d'ordre — il voit
 *      loin, mais il croit ce qui est ecrit ;
 *   2. un APPEL REEL de la route concernee — il ne voit qu'un cas, mais il ne
 *      croit rien.
 *
 * Le releve tient compte du PREFIXE de montage. Une premiere version
 * l'ignorait et annoncait 42 routes mortes, dont 41 ne l'etaient pas :
 * `router.use("/integrations", ...)` confine `/:integrationId` a
 * `/api/integrations/*`. Un releve trop large ne signale pas un probleme, il
 * en fabrique quarante et un — et le lecteur cesse de le lire.
 *
 * (Classe rapportee par la session BatiFlow le 24/09/2026 : chez elle, un
 * `/ouvrages/:id` monte tot tuait un `/ouvrages/impact-tarifs` monte dans un
 * AUTRE fichier plus tard. Elle releve aussi que le remede ne doit pas etre
 * l'ordre de montage — il se defait au premier ajout, en silence — mais un
 * garde dans le handler a parametre.)
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import routeurDocuments from "../routes/documents";

const DIR = join(import.meta.dirname, "..", "routes");
const lire = (f: string) => readFileSync(join(DIR, `${f}.ts`), "utf8").split("\r\n").join("\n");
const INDEX = lire("index");

interface Vue { methode: string; chemin: string; fichier: string; rang: number }

/**
 * Les routes du serveur, dans leur ORDRE DE MONTAGE et avec leur prefixe.
 *
 * L'ordre compte : c'est lui, et lui seul, qui decide laquelle repond.
 */
/**
 * Ce que le releve N'A PAS PU LIRE.
 *
 * Un `catch { continue; }` fait disparaitre un fichier de routeur en silence,
 * et ses routes avec lui : une route litterale masquee dans ce fichier ne
 * serait plus vue, et le controle rendrait « aucune collision » — c'est-a-dire
 * la meme sortie que « tout va bien ».
 *
 * (Panne mesuree par la session BTP-ULTRA le 24/09/2026 sur son propre
 * detecteur : il appelait `grep` via cmd.exe, ou `grep` n'existe pas. L'outil
 * n'a JAMAIS regarde, et a rapporte son incapacite sous la forme d'une
 * absence — sept commentaires justes allaient etre « corriges ». La famille du
 * jour appliquee a l'instrument : une impossibilite de repondre rendue sous la
 * forme d'une reponse.)
 */
const illisibles: string[] = [];

function routesMontees(): Vue[] {
  illisibles.length = 0;
  const fichierDe = new Map<string, string>();
  for (const m of INDEX.matchAll(/import\s+(\w+)\s+from\s+"\.\/([a-z0-9-]+)"/g)) {
    fichierDe.set(m[1]!, m[2]!);
  }
  const vues: Vue[] = [];
  let rang = 0;
  for (const m of INDEX.matchAll(/router\.use\(\s*(?:"([^"]+)"\s*,\s*)?([^)]*?)(\w+Router)\s*\)/g)) {
    const fichier = fichierDe.get(m[3]!);
    if (!fichier) continue;
    let src: string;
    try { src = lire(fichier); } catch (e) { illisibles.push(`${fichier} (${String(e).slice(0, 60)})`); continue; }
    for (const r of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      vues.push({
        methode: r[1]!,
        chemin: ((m[1] ?? "") + r[2]!).replace(/\/+/g, "/"),
        fichier,
        rang: rang++,
      });
    }
  }
  return vues;
}

/** Les routes litterales qu'une route a parametre declaree plus tot capture. */
function collisions(): Array<{ litterale: Vue; parametree: Vue }> {
  const vues = routesMontees();
  const trouvees: Array<{ litterale: Vue; parametree: Vue }> = [];
  for (const r of vues) {
    if (r.chemin.includes(":")) continue;
    const segs = r.chemin.split("/").filter(Boolean);
    for (const p of vues) {
      if (p.rang >= r.rang || p.methode !== r.methode) continue;
      const ps = p.chemin.split("/").filter(Boolean);
      if (ps.length !== segs.length || !ps.some((s) => s.startsWith(":"))) continue;
      if (ps.every((s, i) => s.startsWith(":") || s === segs[i])) trouvees.push({ litterale: r, parametree: p });
    }
  }
  return trouvees;
}

/** Le corps du handler d'une route, jusqu'a la declaration suivante. */
function corpsDuHandler(fichier: string, methode: string, chemin: string): string {
  const src = lire(fichier);
  // Le chemin declare dans le fichier n'inclut pas le prefixe de montage.
  for (const suffixe of [chemin, chemin.replace(/^\/[a-z0-9-]+/, "")]) {
    const i = src.indexOf(`router.${methode}("${suffixe}"`);
    if (i < 0) continue;
    const j = src.indexOf("\nrouter.", i + 10);
    return src.slice(i, j < 0 ? undefined : j);
  }
  return "";
}

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", routeurDocuments);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Masquage ${stamp}`, slug: `masquage-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `masq-${stamp}@example.test`, passwordHash: "x",
    prenom: "M", nom: "Q", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* au mieux */ }
});

describe("le releve mesure bien quelque chose", () => {
  it("il lit les montages de index.ts", () => {
    // Un `router.use` reecrit rendrait zero montage, et zero montage ne
    // produit aucune collision : le controle passerait au vert sans mesurer.
    const m = [...INDEX.matchAll(/router\.use\(\s*(?:"([^"]+)"\s*,\s*)?([^)]*?)(\w+Router)\s*\)/g)];
    expect(m.length, "aucun routeur monte lu dans index.ts").toBeGreaterThan(50);
  });

  it("il releve des centaines de routes", () => {
    expect(routesMontees().length, "le releve des routes est vide").toBeGreaterThan(400);
  });

  it("il voit bien des routes a parametre — sinon il n'y a rien a masquer", () => {
    expect(routesMontees().filter((v) => v.chemin.includes(":")).length).toBeGreaterThan(50);
  });

  it("et il a pu lire CHAQUE fichier de routeur — sinon il ne conclut pas", () => {
    // Le compte total ne suffit pas : 665 routes sur 666 passeraient pour un
    // releve complet, et la route manquante serait justement celle dont on ne
    // saurait rien. On echoue en nommant ce qu'on n'a pas mesure.
    routesMontees();
    expect(illisibles, "ces routeurs n'ont pas ete lus : « aucune collision » ne veut alors rien dire").toEqual([]);
  });

  it("il tient compte du prefixe de montage", () => {
    // Sans le prefixe, `/:integrationId` paraissait masquer quarante routes
    // de premier niveau. Le prefixe le confine a /api/integrations/*.
    const integrations = routesMontees().filter((v) => v.fichier === "integrations");
    expect(integrations.length, "aucune route d'integrations relevee").toBeGreaterThan(3);
    expect(integrations.every((v) => v.chemin.startsWith("/integrations"))).toBe(true);
  });
});

describe("toute collision d'ordre est gardee", () => {
  it("chaque route litterale capturee a un garde qui rend la main", () => {
    // Le garde doit etre DANS le handler a parametre : l'ordre de montage,
    // lui, se defait au premier ajout et sans un mot.
    const sansGarde = collisions()
      .filter(({ parametree }) => !/next\(\);/.test(corpsDuHandler(parametree.fichier, parametree.methode, parametree.chemin)))
      .map(({ litterale, parametree }) => `${litterale.chemin} capturee par ${parametree.chemin}`);
    expect(sansGarde, "route litterale morte : Express sert la premiere qui correspond").toEqual([]);
  });

  it("le garde teste bien la FORME du segment, pas sa seule presence", () => {
    // `if (!req.params.id) next()` ne garderait rien : « by-source » est une
    // chaine non vide, et c'est precisement le cas a intercepter.
    for (const { parametree } of collisions()) {
      const corps = corpsDuHandler(parametree.fichier, parametree.methode, parametree.chemin);
      expect(corps, `${parametree.chemin} : garde sans test de forme`).toMatch(/\/\^?\[?0-9|isNaN|Number\.isInteger|test\(/);
    }
  });

  it("la collision connue est bien celle qu'on croit", () => {
    // Si elle disparait du releve, c'est que le releve a cesse de mordre :
    // on le dit, au lieu de prendre le silence pour une absence de risque.
    const connues = collisions().map((c) => `${c.litterale.chemin}`);
    expect(connues).toContain("/documents/by-source");
  });
});

describe("et la route litterale repond vraiment", () => {
  // Le releve croit la source ; cet appel ne croit rien.
  it("GET /documents/by-source n'est pas capture par /documents/:id", async () => {
    const r = await request(appli()).get("/api/documents/by-source?source=courriel");
    expect(r.status, `capturee comme identifiant : ${r.text}`).not.toBe(400);
    expect(r.status).toBeLessThan(500);
  });

  it("elle ne repond pas « ID invalide » — le symptome exact du masquage", async () => {
    const r = await request(appli()).get("/api/documents/by-source?source=courriel");
    expect(String(r.text)).not.toMatch(/ID invalide|identifiant invalide/i);
  });

  it("un vrai identifiant numerique va bien, lui, au handler a parametre", async () => {
    // Le controle negatif : si `/documents/:id` rendait la main a TOUT, le
    // test precedent passerait pour une mauvaise raison.
    const r = await request(appli()).get("/api/documents/999999999");
    expect([403, 404]).toContain(r.status);
  });

  it("un segment non numerique inconnu finit en 404, pas en 400", async () => {
    // Il n'est capture par rien : c'est le comportement attendu d'un chemin
    // qui n'existe pas, et non celui d'un identifiant mal forme.
    const r = await request(appli()).get("/api/documents/chemin-qui-nexiste-pas");
    expect(r.status).not.toBe(400);
  });
});
