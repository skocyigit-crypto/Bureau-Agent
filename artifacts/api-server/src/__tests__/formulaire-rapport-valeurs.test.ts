/**
 * Le formulaire de rapport ne propose que des valeurs que la route accepte.
 *
 * Le 24/09/2026, les DEUX ecrans mobiles qui envoient un rapport proposaient
 * des categories et des priorites qui n'existent pas cote serveur :
 *
 *   /reports        « bug », « amelioration », « question », « acces »,
 *                   « normale », « critique »
 *
 * La route n'accepte que general/technique/facturation/securite/autre et
 * basse/normal/haute/urgente. Chaque envoi repondait 400 « Categorie
 * invalide », et l'ecran n'affichait que « L'action a echoue ».
 *
 * Le plus couteux : la categorie PAR DEFAUT de /reports etait « bug » et sa
 * priorite par defaut « normale ». Le formulaire echouait donc sans que
 * personne n'ouvre le moindre menu — c'est-a-dire toujours. Et c'est l'ecran
 * par lequel un client signale que quelque chose ne marche pas : la panne
 * emportait le canal qui sert a signaler les pannes.
 *
 * Enfin « securite », la seule categorie a laquelle du COMPORTEMENT est
 * attache (`prioriteSupport` la fait toujours remonter en priorite haute),
 * n'etait proposee par aucun des deux ecrans : le chemin d'escalade existait
 * sans porte d'entree.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/support-inbox", async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  return { ...reel, processIncomingSupportEmail: async () => ({ ok: true }) };
});

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { adminReportsTable, db, organisationsTable, usersTable } from "@workspace/db";
import router, { CATEGORIES_RAPPORT, PRIORITES_RAPPORT } from "../routes/admin-reports";
import { prioriteSupport } from "../services/transfert-rapport-admin";

const MOBILE = join(import.meta.dirname, "..", "..", "..", "mobile");
// `/admin-reports` a ete retire : il portait le meme formulaire en moins
// complet, et l'onglet « equipe » faisait doublon avec l'ecran Utilisateurs.
// Deux ecrans pour le meme geste, c'est deux corrections a faire a chaque
// fois — et une oubliee tot ou tard.
const ECRANS = {
  "/reports": readFileSync(join(MOBILE, "app", "reports.tsx"), "utf8"),
};

/**
 * Les valeurs offertes par un menu deroulant de l'ecran, lues dans la source.
 *
 * On ne lit QUE les blocs `options: [ ... ]` du champ vise, sinon le releve
 * ramasserait les roles, les statuts et les filtres — et un releve trop large
 * rend ce controle vert par accident.
 */
function valeursOffertes(source: string, champ: "category" | "priority"): string[] {
  const i = source.indexOf(`key: "${champ}"`);
  if (i < 0) return [];
  const debut = source.indexOf("options: [", i);
  if (debut < 0) return [];
  const fin = source.indexOf("]}", debut) >= 0 ? source.indexOf("]}", debut) : source.indexOf("],", debut);
  return [...source.slice(debut, fin).matchAll(/value: "([^"]+)"/g)].map((m) => m[1]!);
}

/** Les cles d'un dictionnaire d'affichage (`CATEGORY_MAP`, `PRIORITY_MAP`). */
function clesDuTableau(source: string, nom: string): string[] {
  const i = source.indexOf(`const ${nom}`);
  if (i < 0) return [];
  const debut = source.indexOf("= {", i);
  const fin = source.indexOf("\n};", debut);
  return [...source.slice(debut, fin).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
}

/** La valeur posee par defaut a l'ouverture du formulaire. */
function valeurParDefaut(source: string, champ: "category" | "priority"): string | undefined {
  const m = source.match(new RegExp(`useState<Record<string, string>>\\(\\{[^}]*${champ}: "([^"]+)"`));
  return m?.[1];
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
  a.use("/api", router);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Rapports ${stamp}`, slug: `rapports-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `rap-${stamp}@example.test`, passwordHash: "x",
    prenom: "R", nom: "A", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(adminReportsTable).where(eq(adminReportsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* nettoyage au mieux */ }
});

describe("le releve mesure bien quelque chose", () => {
  // Sans ce garde-fou, une source restructuree rendrait des listes vides, et
  // une liste vide satisfait n'importe quelle comparaison.
  it.each(Object.entries(ECRANS))("%s offre des categories et des priorites", (_nom, src) => {
    expect(valeursOffertes(src, "category").length).toBeGreaterThan(2);
    expect(valeursOffertes(src, "priority").length).toBeGreaterThan(2);
  });

  it("la liste du serveur n'est pas vide non plus", () => {
    expect(CATEGORIES_RAPPORT.length).toBeGreaterThan(2);
    expect(PRIORITES_RAPPORT.length).toBeGreaterThan(2);
  });
});

describe("ce que l'ecran propose, la route l'accepte", () => {
  it.each(Object.entries(ECRANS))("%s : aucune categorie inconnue du serveur", (_nom, src) => {
    const refusees = valeursOffertes(src, "category").filter((v) => !(CATEGORIES_RAPPORT as readonly string[]).includes(v));
    expect(refusees, "ces choix repondraient 400 « Categorie invalide »").toEqual([]);
  });

  it.each(Object.entries(ECRANS))("%s : aucune priorite inconnue du serveur", (_nom, src) => {
    const refusees = valeursOffertes(src, "priority").filter((v) => !(PRIORITES_RAPPORT as readonly string[]).includes(v));
    expect(refusees, "ces choix repondraient 400 « Priorite invalide »").toEqual([]);
  });

  it.each(Object.entries(ECRANS))("%s : la valeur par defaut passe", (_nom, src) => {
    // Le defaut d'origine : /reports ouvrait sur category « bug », donc
    // echouait sans qu'on touche au formulaire.
    const cat = valeurParDefaut(src, "category");
    const prio = valeurParDefaut(src, "priority");
    expect(cat && (CATEGORIES_RAPPORT as readonly string[]).includes(cat), `categorie par defaut : ${cat}`).toBe(true);
    expect(prio && (PRIORITES_RAPPORT as readonly string[]).includes(prio), `priorite par defaut : ${prio}`).toBe(true);
  });

  it("le signalement de securite est atteignable depuis au moins un ecran", () => {
    // « securite » est la seule categorie a laquelle du comportement est
    // attache. Si aucun ecran ne la propose, l'escalade est du code mort.
    const offertePartout = Object.values(ECRANS).some((s) => valeursOffertes(s, "category").includes("securite"));
    expect(offertePartout, "le chemin d'escalade n'a pas de porte d'entree").toBe(true);
  });

  it("et cette categorie remonte bien en priorite haute", () => {
    expect(prioriteSupport("securite", "basse")).toBe("haute");
  });
});

/*
 * LE SENS INVERSE : le serveur accepte une valeur qu'aucun ecran n'offre.
 *
 * C'est le meme desaccord, mais il ne rend AUCUNE erreur — il n'y a rien a
 * cliquer. Le cas « securite » ci-dessus en etait un : la route l'acceptait,
 * `prioriteSupport` en tirait une escalade, et aucun des deux ecrans ne
 * permettait de la choisir. Une porte ouverte sans couloir pour y mener.
 *
 * (Sens signale par la session Assise le 24/09/2026 : chez elle la route des
 * documents accepte un type « acompte » que tout l'appareil comptable
 * attend — compte 419100, reprise sur la facture de solde — et qu'aucun
 * ecran n'offre. La comptabilite est juste, la route est ouverte, et
 * personne ne peut emettre le document.)
 */
describe("ce que la route accepte, un ecran le propose", () => {
  const offertes = (champ: "category" | "priority") =>
    new Set(Object.values(ECRANS).flatMap((s) => valeursOffertes(s, champ)));

  it("chaque categorie acceptee est atteignable depuis un ecran", () => {
    const orphelines = CATEGORIES_RAPPORT.filter((c) => !offertes("category").has(c));
    expect(orphelines, "acceptees par la route, offertes nulle part").toEqual([]);
  });

  it("chaque priorite acceptee est atteignable depuis un ecran", () => {
    const orphelines = PRIORITES_RAPPORT.filter((p) => !offertes("priority").has(p));
    expect(orphelines, "acceptees par la route, offertes nulle part").toEqual([]);
  });

  it("la comparaison porte sur une surface reelle, pas sur trois cas", () => {
    // Un zero obtenu sur 3 % de la surface n'est pas une conformite : c'est
    // une mesure qui n'a pas eu lieu. On compte donc ce qu'on a compare.
    expect(offertes("category").size).toBeGreaterThanOrEqual(CATEGORIES_RAPPORT.length);
    expect(offertes("priority").size).toBeGreaterThanOrEqual(PRIORITES_RAPPORT.length);
  });

});

describe("ce que l'ecran affiche couvre ce que la base contient", () => {
  it("/reports sait nommer chaque categorie du serveur", () => {
    // Sinon le repli s'applique : un rapport « securite » s'affichait
    // « Autre ». La categorie la plus urgente etait la plus invisible.
    const connues = clesDuTableau(ECRANS["/reports"], "CATEGORY_MAP");
    expect(CATEGORIES_RAPPORT.filter((c) => !connues.includes(c))).toEqual([]);
  });

  it("/reports sait nommer chaque priorite du serveur", () => {
    const connues = clesDuTableau(ECRANS["/reports"], "PRIORITY_MAP");
    expect(PRIORITES_RAPPORT.filter((p) => !connues.includes(p))).toEqual([]);
  });

  it("il ne reste qu'UN ecran a verifier", () => {
    // Le second — `/admin-reports` — a ete retire : meme formulaire en moins
    // complet, plus un onglet « equipe » qui doublonnait avec Utilisateurs.
    // On le constate ici pour que le controle ne passe pas silencieusement
    // d'une couverture de deux ecrans a une couverture d'un seul sans que
    // personne s'en avise.
    expect(Object.keys(ECRANS)).toEqual(["/reports"]);
  });

  it("aucun ecran ne garde une case d'affichage sans valeur correspondante", () => {
    // L'autre sens : une entree « bug » qui ne peut plus arriver est une
    // promesse morte, et fait croire que la categorie existe encore.
    for (const [nom, src] of Object.entries(ECRANS)) {
      const orphelines = clesDuTableau(src, "CATEGORY_MAP").filter((c) => !(CATEGORIES_RAPPORT as readonly string[]).includes(c));
      expect(orphelines, `${nom} : categories d'affichage sans valeur serveur`).toEqual([]);
    }
  });
});

describe("l'envoi aboutit vraiment, pour chaque choix offert", () => {
  const envoyer = (body: Record<string, unknown>) =>
    request(appli()).post("/api/admin-reports").send({ subject: "Essai", message: "Detail", ...body });

  it.each([...CATEGORIES_RAPPORT])("categorie %s : enregistree", async (cat) => {
    const r = await envoyer({ category: cat, priority: "normal" });
    expect(r.status, r.text).toBeLessThan(300);
    const [ligne] = await db.select().from(adminReportsTable).where(eq(adminReportsTable.id, r.body.report?.id ?? r.body.id));
    expect(ligne?.category).toBe(cat);
  });

  it.each([...PRIORITES_RAPPORT])("priorite %s : enregistree", async (prio) => {
    const r = await envoyer({ category: "general", priority: prio });
    expect(r.status, r.text).toBeLessThan(300);
    const [ligne] = await db.select().from(adminReportsTable).where(eq(adminReportsTable.id, r.body.report?.id ?? r.body.id));
    expect(ligne?.priority).toBe(prio);
  });

  it("les anciens choix des ecrans sont bien refuses — c'etait le symptome", async () => {
    // Si l'un d'eux passait, c'est que la route s'est elargie en silence et
    // que ce fichier ne protege plus rien.
    for (const cat of ["bug", "amelioration", "question", "acces", "fonctionnalite"]) {
      expect((await envoyer({ category: cat })).status, `categorie ${cat}`).toBe(400);
    }
    for (const prio of ["normale", "critique"]) {
      expect((await envoyer({ priority: prio })).status, `priorite ${prio}`).toBe(400);
    }
  });

  it("le defaut reel de chaque ecran passe, envoye tel quel", async () => {
    // Le test qui aurait attrape la panne : on envoie ce que l'ecran envoie.
    for (const [nom, src] of Object.entries(ECRANS)) {
      const r = await envoyer({
        category: valeurParDefaut(src, "category"),
        priority: valeurParDefaut(src, "priority"),
      });
      expect(r.status, `${nom} : ${r.text}`).toBeLessThan(300);
    }
  });
});
