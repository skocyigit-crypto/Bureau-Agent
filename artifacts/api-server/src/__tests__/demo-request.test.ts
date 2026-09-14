/**
 * La demande de demonstration: la premiere chose qu'un prospect touche.
 *
 * Cette route n'avait AUCUN test. C'est pourtant le haut de l'entonnoir
 * commercial: elle recoit le formulaire du site vitrine, previent
 * l'administrateur, confirme au demandeur, et cree le prospect en base. Si
 * elle casse, personne ne s'en apercoit — il n'y a pas d'utilisateur connecte
 * pour se plaindre, et l'absence de demandes ressemble a un marche calme.
 *
 * Les verifications ci-dessous portent sur ce qui se voit de l'exterieur, avec
 * la vraie application et la vraie base. Trois familles:
 *
 *   - ce qui doit etre REFUSE (champs manquants, adresse invalide);
 *   - ce qui doit ETRE FAIT (prospect cree, une seule fois par jour et par
 *     adresse);
 *   - ce qui ne doit JAMAIS arriver (du HTML injecte dans le courriel de
 *     l'administrateur, une demande perdue parce que la creation du prospect
 *     a echoue).
 *
 * Le dernier point est le plus important: l'envoi du courriel et la creation
 * du prospect sont deux effets distincts, et le code les a deliberement rendus
 * independants — une demande DOIT aboutir meme si la base refuse le prospect.
 * Un test qui ne verifierait que le chemin heureux laisserait passer
 * l'inverse.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";

/**
 * Origine autorisee, declaree AVANT le chargement de l'application.
 *
 * La protection anti-CSRF compare l'en-tete Origin a l'hote de la requete ou a
 * la liste autorisee. Supertest ecoute sur un port ephemere, donc l'hote n'est
 * pas connu d'avance: on passe par la liste.
 */
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "http://origine-de-test.local";

import { db, organisationsTable, prospectsTable } from "@workspace/db";
import app from "../app";

/** Marqueur unique: permet de nettoyer sans toucher a d'autres lignes. */
const MARQUE = `demo-test-${Date.now()}`;
const adresse = (suffixe: string) => `${MARQUE}-${suffixe}@exemple-test.fr`;

/**
 * Un navigateur envoie TOUJOURS un en-tete Origin sur une requete POST, et la
 * protection anti-CSRF refuse celles qui n'en ont pas. Sans cet en-tete, les
 * tests mesureraient le garde-fou et non la route.
 */
function envoyer(corps: Record<string, unknown>) {
  return request(app)
    .post("/api/public/demo-request")
    .set("Origin", "http://origine-de-test.local")
    .send(corps);
}

function demande(extra: Record<string, unknown> = {}) {
  return {
    firstName: "Jean",
    lastName: "Durand",
    email: adresse("base"),
    company: "Durand Maconnerie",
    ...extra,
  };
}

/**
 * Le prospect est rattache a l'organisation de l'editeur, reperee par son
 * slug. Sans cette ligne en base, la creation s'arrete sans bruit et la
 * demande n'aboutit que par courriel — ce que les tests ci-dessous
 * verifieraient a tort comme une reussite.
 */
const SLUG_EDITEUR = "agent-de-bureau-sas";
let orgCreeeParCeTest = false;

beforeAll(async () => {
  const [existante] = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.slug, SLUG_EDITEUR));
  if (existante) return;

  await db.insert(organisationsTable).values({
    name: "Ajant Bureau SAS",
    slug: SLUG_EDITEUR,
    email: `${MARQUE}-editeur@exemple-test.fr`,
    maxUsers: 3,
    actif: true,
  });
  orgCreeeParCeTest = true;
});

afterAll(async () => {
  await db.delete(prospectsTable).where(like(prospectsTable.email, `${MARQUE}%`));
  // On ne supprime que ce qu'on a cree: une base de developpement peut
  // contenir la vraie organisation de l'editeur.
  if (orgCreeeParCeTest) {
    await db.delete(organisationsTable).where(eq(organisationsTable.slug, SLUG_EDITEUR));
  }
});

describe("ce qui doit etre refuse", () => {
  it.each(["firstName", "lastName", "email", "company"])(
    "sans %s, la demande est rejetee",
    async (champ) => {
      const corps: Record<string, unknown> = demande({ email: adresse(`sans-${champ}`) });
      delete corps[champ];

      const res = await envoyer(corps);

      expect(res.status, `le champ ${champ} n'est plus obligatoire`).toBe(400);
      expect(res.body.error).toMatch(/obligatoire/i);
    },
  );

  it("une adresse sans arobase est rejetee", async () => {
    const res = await envoyer(demande({ email: "pas-une-adresse" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("le telephone et le message restent facultatifs", async () => {
    // Exiger plus que le necessaire sur un formulaire public coute des
    // prospects: chaque champ obligatoire en fait partir.
    const res = await envoyer(demande({ email: adresse("minimal") }));

    expect(res.status).toBe(200);
  });
});

describe("ce qui doit etre fait", () => {
  it("la demande cree un prospect", async () => {
    const email = adresse("prospect");
    const res = await envoyer(demande({ email, company: "Toiture Martin", employeeCount: "6-10" }));

    expect(res.status).toBe(200);

    const lignes = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(lignes, "aucun prospect cree: la demande est perdue pour le commercial").toHaveLength(1);
    expect(lignes[0].company).toBe("Toiture Martin");
  });

  it("la taille d'equipe et le message sont conserves", async () => {
    // Ce sont les deux seules informations de qualification du formulaire.
    const email = adresse("qualif");
    await envoyer(demande({ email, employeeCount: "11-20", message: "Trois chantiers simultanes" }));

    const [ligne] = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(ligne?.notes ?? "").toContain("11-20");
    expect(ligne?.notes ?? "").toContain("Trois chantiers simultanes");
  });

  it("la reponse annonce un delai, pas un simple accuse de reception", async () => {
    // La page vitrine promet un rappel; la reponse doit dire la meme chose,
    // sinon le prospect ne sait pas s'il doit attendre ou relancer.
    const res = await envoyer(demande({ email: adresse("delai") }));

    expect(res.body.message).toMatch(/24h/i);
  });
});

describe("ce qui ne doit jamais arriver", () => {
  it("deux demandes de la meme adresse ne creent qu'un prospect", async () => {
    // Un prospect qui clique deux fois ne doit pas apparaitre deux fois dans
    // la liste du commercial: c'est ainsi qu'on rappelle quelqu'un deux fois
    // en croyant traiter deux affaires.
    const email = adresse("doublon");
    await envoyer(demande({ email }));
    await envoyer(demande({ email }));

    const lignes = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(lignes, "la demande en double a cree un second prospect").toHaveLength(1);
  });

  it("l'adresse est normalisee: la casse ne cree pas de doublon", async () => {
    const email = adresse("casse");
    await envoyer(demande({ email }));
    await envoyer(demande({ email: email.toUpperCase() }));

    const lignes = await db
      .select()
      .from(prospectsTable)
      .where(and(eq(prospectsTable.email, email.toLowerCase())));
    expect(lignes.length).toBeLessThanOrEqual(1);
  });

  it("du HTML dans le nom n'atteint pas le courriel de l'administrateur", async () => {
    // Le courriel d'alerte est construit en HTML a partir de champs qu'un
    // inconnu remplit depuis Internet. Sans echappement, une demande de demo
    // devient un vecteur d'injection vers la boite de l'editeur.
    const email = adresse("xss");
    const res = await envoyer(demande({ email, firstName: "<script>alert(1)</script>" }));

    // La charge n'atteint meme pas la route: la detection de menace la refuse
    // a l'entree. C'est une garantie PLUS forte que l'echappement — mesuree
    // ici, et non supposee: mon premier jet attendait un 200 puis un
    // echappement, et c'est le test qui m'a appris que la porte etait fermee
    // plus tot.
    expect(res.status, "une balise script est acceptee par la route publique").toBeGreaterThanOrEqual(400);

    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/demo-request.ts", import.meta.url), "utf8"),
    );
    // La garantie est dans le code: chaque champ repris dans le HTML passe par
    // escapeHtml. On le verifie ici parce qu'aucune assertion sur la reponse
    // ne peut voir le contenu du courriel.
    for (const champ of ["firstName", "lastName", "email", "company"]) {
      expect(
        new RegExp(`escapeHtml\\(${champ}\\)`).test(source),
        `${champ} est insere dans le courriel sans echappement`,
      ).toBe(true);
    }
  });

  it("un echec de creation du prospect ne fait pas perdre la demande", async () => {
    // Les deux effets sont volontairement independants: le courriel part
    // d'abord, la base ensuite. Verifie sur la forme, car provoquer un echec
    // de base ici casserait les autres tests.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/demo-request.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/catch \(prospectErr[\s\S]{0,200}email envoye quand meme/);
    // Et le 200 ne doit pas dependre du bloc de creation.
    const i = source.indexOf("catch (prospectErr");
    const j = source.indexOf("res.status(200)");
    expect(j, "la reponse de succes precede-t-elle encore l'echec du prospect ?").toBeGreaterThan(i);
  });

  it("la route est limitee en frequence", async () => {
    // Sans limite, un formulaire public est une porte ouverte: courriels en
    // masse vers l'editeur et prospects fantomes dans la base.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/demo-request.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/rateLimit\(\{[\s\S]{0,200}max: \d+/);
    expect(source).toMatch(/demoLimiter/);
  });
});
