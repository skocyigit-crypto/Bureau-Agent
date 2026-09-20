/**
 * Les deux formulaires d'entree du produit ne promettent plus ce qu'ils n'ont
 * pas fait.
 *
 * `sendEmail` NE LEVE PAS en cas d'echec fournisseur : elle rend
 * `{ success: false, error }` (voir `services/email.ts`). Les deux routes
 * publiques — demande de devis / rappel, et demande de demonstration —
 * jetaient cette valeur, puis repondaient 200 :
 *
 *   « Votre demande a ete envoyee. Vous recevrez un devis sous 24h ouvrees. »
 *
 * Si la chaine d'e-mail etait en panne, le visiteur repartait avec une
 * promesse que personne n'avait recue, et l'alerte vers l'equipe n'etait pas
 * partie non plus. C'est le premier ecran du produit, et l'endroit ou une
 * piste commerciale se perd le plus cher.
 *
 * La correction ne consiste pas a refuser la demande des qu'un courriel
 * echoue : le PROSPECT en base est le vrai filet, c'est lui qui fait que
 * l'equipe rappellera. Tant que l'un des deux tient, la promesse est vraie.
 *
 * UN DEFAUT TROUVE EN ECRIVANT CE CONTROLE
 *
 * Les deux fonctions qui creent le prospect ne rendaient RIEN, et sortaient
 * silencieusement quand aucune organisation super-admin n'existe. L'appelant
 * en deduisait « piste captee » alors que rien n'avait ete ecrit —
 * c'est-a-dire exactement le mensonge qu'on cherchait a supprimer. Elles
 * rendent desormais un booleen, et un doublon dedoublonne compte comme
 * capte : la fiche EST dans le CRM.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGE_DEMANDE_PERDUE, suiteDemande } from "../services/demande-entrante";

const ROUTES = join(import.meta.dirname, "..", "routes");

describe("ce qu'on a le droit de repondre a un visiteur", () => {
  it("tout va bien: la demande est transmise", () => {
    expect(suiteDemande(true, true)).toBe("transmise");
  });

  it("l'alerte est partie, le prospect n'a pas pu etre cree: transmise", () => {
    // L'equipe a recu le courriel: elle rappellera.
    expect(suiteDemande(false, true)).toBe("transmise");
  });

  it("le prospect est en base, l'alerte n'est pas partie: transmise", () => {
    // La fiche est dans le CRM: refuser la demande perdrait une piste deja
    // captee, et renverrait le visiteur sur un formulaire qui a marche.
    expect(suiteDemande(true, false)).toBe("transmise");
  });

  it("rien n'a abouti: perdue", () => {
    // Personne ne sait que cette personne a ecrit. Lui promettre un rappel
    // est le pire des deux maux.
    expect(suiteDemande(false, false)).toBe("perdue");
  });

  it("le message de perte dit quoi faire", () => {
    // Un visiteur a qui l'on repond « erreur » ferme l'onglet.
    expect(MESSAGE_DEMANDE_PERDUE).toMatch(/reessayer/i);
    expect(MESSAGE_DEMANDE_PERDUE).toMatch(/ecrire/i);
  });
});

describe("les deux routes appliquent cette regle, et la meme", () => {
  const sources = {
    "contact-request.ts": readFileSync(join(ROUTES, "contact-request.ts"), "utf8"),
    "demo-request.ts": readFileSync(join(ROUTES, "demo-request.ts"), "utf8"),
  };

  for (const [nom, source] of Object.entries(sources)) {
    it(`${nom}: le resultat de l'alerte est LU`, () => {
      // Le defaut d'origine tenait en un `await sendEmail(...)` dont la
      // valeur partait a la poubelle.
      expect(source, "la valeur de l'envoi est de nouveau jetee").toMatch(/const alerte = await sendEmail\(/);
    });

    it(`${nom}: la decision passe par la regle partagee`, () => {
      expect(source).toMatch(/suiteDemande\(prospectCree, alerte\.success\)/);
    });

    it(`${nom}: une demande perdue repond 502`, () => {
      const i = source.indexOf("=== \"perdue\"");
      expect(i, "la branche de perte a disparu").toBeGreaterThan(0);
      expect(source.slice(i, i + 400)).toMatch(/res\.status\(502\)/);
    });

    it(`${nom}: le prospect est cree AVANT les courriels`, () => {
      // L'ordre n'est pas cosmetique: c'est lui qui garantit que la piste
      // survit a une panne de la chaine d'e-mail.
      const iProspect = source.indexOf("prospectCree = await createProspectFrom");
      const iAlerte = source.indexOf("const alerte = await sendEmail(");
      expect(iProspect, "la creation du prospect a disparu").toBeGreaterThan(0);
      expect(iAlerte).toBeGreaterThan(iProspect);
    });

    it(`${nom}: l'accuse au visiteur ne fait pas echouer la demande`, () => {
      // Un accuse qui ne part pas est un confort perdu, pas une piste perdue.
      // La borne est la decision suivante, pas un nombre de caracteres: une
      // fenetre fixe debordait sur la branche 502 qui suit et criait au loup.
      const i = source.indexOf("const confirmation = await sendEmail(");
      const fin = source.indexOf("suiteDemande(prospectCree", i);
      expect(i).toBeGreaterThan(0);
      expect(fin).toBeGreaterThan(i);
      const bloc = source.slice(i, fin);
      expect(bloc).toMatch(/logger\.warn/);
      expect(bloc, "un accuse manquant renvoie une erreur au visiteur").not.toMatch(/res\.status\(50\d\)/);
    });

    it(`${nom}: la fonction de capture rend bien un booleen`, () => {
      // Sans cela, « piste captee » serait vrai meme quand rien n'a ete
      // ecrit — l'organisation super-admin absente sortait en silence.
      expect(source).toMatch(/Promise<boolean>/);
      expect(source).toMatch(/return Boolean\(created\?\.id\)/);
    });

    it(`${nom}: une organisation super-admin absente rend faux`, () => {
      const i = source.indexOf("Organisation super-admin introuvable");
      expect(i).toBeGreaterThan(0);
      expect(source.slice(i, i + 200), "le cas « rien ecrit » compte encore comme capte").toMatch(/return false;/);
    });

    it(`${nom}: un doublon dedoublonne compte comme capte`, () => {
      // La fiche EST dans le CRM: repondre « perdue » serait faux.
      const i = source.indexOf("deduplication.");
      expect(i).toBeGreaterThan(0);
      expect(source.slice(i, i + 200)).toMatch(/return true;/);
    });
  }
});

describe("l'appel au modele de compte rendu a une borne", () => {
  const source = readFileSync(join(ROUTES, "meetings.ts"), "utf8");

  it("meetings/compile pose un delai d'attente", () => {
    // `fetch()` n'a pas de delai par defaut, et `server.requestTimeout` n'est
    // pas pose: sans borne, un fournisseur lent gardait une place de
    // l'instance jusqu'au defaut de Node, cinq minutes.
    expect(source, "l'appel au modele est de nouveau sans borne").toMatch(/signal: AbortSignal\.timeout\(/);
  });

  it("et cette borne est une vraie duree", () => {
    const m = /const DELAI_MODELE_MS = ([\d_]+);/.exec(source);
    expect(m, "la constante a disparu").toBeTruthy();
    const ms = Number(m![1]!.replace(/_/g, ""));
    expect(ms).toBeGreaterThan(1000);
    expect(ms, "une borne de plus d'une minute ne borne plus grand-chose").toBeLessThanOrEqual(60_000);
  });

  it("c'etait le dernier appel de modele sans borne", () => {
    // Le controle porte sur le MOTIF, pas sur ce fichier: un appel ajoute
    // demain sans `signal` le fera tomber.
    const nus: string[] = [];
    for (const fichier of ["meetings.ts", "ai-analysis.ts", "ai-commandant.ts", "voice-receptionist.ts"]) {
      const s = readFileSync(join(ROUTES, fichier), "utf8");
      for (const m of s.matchAll(/await fetch\(\s*\n?\s*`[^`]*generateContent[^`]*`/g)) {
        const suite = s.slice(m.index!, m.index! + 1200);
        if (!/signal:/.test(suite)) nus.push(`${fichier} @${m.index}`);
      }
    }
    expect(nus, `appel de modele sans delai d'attente: ${nus.join(", ")}`).toEqual([]);
  });
});
