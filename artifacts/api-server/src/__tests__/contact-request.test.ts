/**
 * L'autre formulaire public: « rappelez-moi » et « demande de devis ».
 *
 * 324 lignes, aucun test. C'est le jumeau de la demande de demonstration, avec
 * le meme mode de panne: s'il casse, rien ne le signale. Pas d'utilisateur
 * connecte pour se plaindre, et l'absence de demandes ressemble a un marche
 * calme.
 *
 * Il fait davantage que son jumeau — il distingue deux natures de demande,
 * cree un prospect, et alerte l'administrateur par SMS pour les demandes de
 * devis — donc il a plus d'endroits ou echouer en silence.
 *
 * Comme pour la demande de demo, la moitie des verifications porte sur ce qui
 * ne doit JAMAIS arriver: c'est la que ce parcours perd de l'argent sans
 * bruit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";

/** Origine autorisee: la protection anti-CSRF refuse les requetes sans Origin. */
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "http://origine-de-test.local";

import { db, organisationsTable, prospectsTable } from "@workspace/db";
import app from "../app";

const MARQUE = `contact-test-${Date.now()}`;
const adresse = (suffixe: string) => `${MARQUE}-${suffixe}@exemple-test.fr`;

const SLUG_EDITEUR = "agent-de-bureau-sas";
let orgCreeeParCeTest = false;

let visiteur = 0;

/**
 * Chaque envoi vient d'une adresse distincte.
 *
 * Le limiteur compte 10 demandes par heure et PAR IP. Sans cela, les tests se
 * limitaient entre eux et les derniers recevaient un 429 — on aurait mesure le
 * garde-fou au lieu de la route, et pire: on aurait pu croire la route cassee.
 */
function envoyer(corps: Record<string, unknown>) {
  visiteur += 1;
  return request(app)
    .post("/api/public/contact-request")
    .set("Origin", "http://origine-de-test.local")
    .set("X-Forwarded-For", `203.0.113.${visiteur}`)
    .send(corps);
}

function demande(extra: Record<string, unknown> = {}) {
  return {
    kind: "rappel",
    // Un rappel sans numero n'est pas un rappel: la route l'exige.
    phone: "0600000000",
    firstName: "Claire",
    lastName: "Moreau",
    email: adresse("base"),
    company: "Moreau Electricite",
    ...extra,
  };
}

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
    },
  );

  it("une nature de demande inconnue est rejetee", async () => {
    // Le type decide du traitement (SMS a l'administrateur pour un devis).
    // L'accepter au hasard ferait traiter une demande comme une autre.
    const res = await envoyer(demande({ kind: "autre-chose", email: adresse("kind") }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it("une nature absente est rejetee", async () => {
    const corps: Record<string, unknown> = demande({ email: adresse("sans-kind") });
    delete corps.kind;
    expect((await envoyer(corps)).status).toBe(400);
  });

  it.each(["pas-darobase", "sans@point", "@rien.fr"])(
    "l'adresse %s est refusee",
    async (email) => {
      // La validation est plus stricte que sur la demande de demo: elle exige
      // un domaine avec point. Une adresse fausse ici, c'est un prospect que
      // personne ne pourra jamais rappeler.
      const res = await envoyer(demande({ email }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    },
  );
});

describe("ce qui doit etre fait", () => {
  it("une demande de rappel cree un prospect", async () => {
    const email = adresse("rappel");
    const res = await envoyer(demande({ email, kind: "rappel" }));

    expect(res.status).toBe(200);
    const lignes = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(lignes, "la demande de rappel n'a cree aucun prospect").toHaveLength(1);
  });

  it("une demande de devis cree un prospect", async () => {
    const email = adresse("devis");
    const res = await envoyer(
      demande({ email, kind: "devis", budget: "5000-10000", employeeCount: "6-10" }),
    );

    expect(res.status).toBe(200);
    const lignes = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(lignes).toHaveLength(1);
  });

  it("le budget annonce est conserve", async () => {
    // C'est la seule information de qualification commerciale du formulaire:
    // la perdre revient a rappeler a l'aveugle.
    const email = adresse("budget");
    await envoyer(demande({ email, kind: "devis", budget: "20000-50000" }));

    const [ligne] = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(ligne?.notes ?? "").toContain("20000");
  });
});

describe("ce qui ne doit jamais arriver", () => {
  it("deux envois de la meme adresse ne creent pas deux prospects", async () => {
    const email = adresse("doublon");
    await envoyer(demande({ email }));
    await envoyer(demande({ email }));

    const lignes = await db.select().from(prospectsTable).where(eq(prospectsTable.email, email));
    expect(lignes, "un visiteur qui clique deux fois apparait deux fois").toHaveLength(1);
  });

  it("les champs repris dans le courriel sont echappes", async () => {
    // Le courriel d'alerte est construit en HTML a partir de champs qu'un
    // inconnu remplit depuis Internet.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/contact-request.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/escapeHtml\(/);
    expect(source).toMatch(/escapeAttr\(/);
  });

  it("la route est limitee en frequence", async () => {
    // Un formulaire public sans limite est une porte ouverte: courriels en
    // masse vers l'editeur, SMS factures, et prospects fantomes.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/contact-request.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/contactLimiter/);
    expect(source).toMatch(/rateLimit\(\{[\s\S]{0,200}max: \d+/);
  });

  it("l'absence de configuration SMS ne fait pas echouer la demande", async () => {
    // Le SMS d'alerte est un confort pour l'editeur; la demande du client ne
    // doit pas en dependre. Sans cette independance, une cle expiree chez
    // l'operateur ferait perdre des prospects.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/contact-request.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/if \(!accountSid \|\| !authToken \|\| !fromNumber\)/);

    // Et la preuve par le comportement: en test, aucune configuration SMS
    // n'est presente, et la demande aboutit quand meme.
    const res = await envoyer(demande({ email: adresse("sans-sms"), kind: "devis" }));
    expect(res.status).toBe(200);
  });
});
