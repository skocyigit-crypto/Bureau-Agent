/**
 * Le produit savait que le fichier etait dangereux, et le servait quand meme.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * La colonne `scanVerdict` existe, elle est renseignee, et elle n'etait lue
 * qu'a trois endroits : un filtre de liste, trois compteurs de tableau de bord
 * (« safe », « dangerous », « unscanned »), et une jauge de progression du
 * rescan groupe.
 *
 * La route de telechargement ne la SELECTIONNAIT meme pas.
 *
 * LE CHEMIN COMPLET, ET IL EST ATTEIGNABLE
 *
 * `ingestDocument` applique une garde heuristique SYNCHRONE qui bloque les
 * menaces evidentes, puis INSERE, puis lance l'antivirus complet EN ARRIERE-
 * PLAN. Un fichier qui passe l'heuristique et echoue au scan complet est donc
 * deja stocke quand le verdict tombe.
 *
 * A partir de la :
 *   1. l'upload a repondu « ok » ;
 *   2. le scan de fond pose `scanVerdict = 'dangerous'` ;
 *   3. le tableau de bord l'affiche dans le compteur « dangereux » ;
 *   4. le telechargement le remet, avec le `Content-Type` declare, sans un mot.
 *
 * Le produit SAIT, et ne dit rien a celui qui clique.
 *
 * CE QUI ETAIT DEJA SOIGNE, ET QUI LE RESTE
 *
 * Les en-tetes de telechargement sont serieux : `nosniff` contre le MIME
 * sniffing, CSP `sandbox` pour neutraliser un script inline, `attachment` pour
 * forcer la sauvegarde, et un nom de fichier nettoye des retours chariot pour
 * empecher l'injection d'en-tete. Ce travail-la etait fait.
 *
 * POURQUOI ON NE BLOQUE PAS DEFINITIVEMENT
 *
 * Le fichier appartient au client. Un faux positif est possible, et il peut
 * avoir besoin de le recuperer pour le transmettre a son propre antivirus ou
 * a un expert. Le supprimer ou l'enfermer serait decider a sa place.
 *
 * Le produit cesse simplement de le remettre SANS UN MOT : refus par defaut,
 * levee par une confirmation explicite, et la levee est journalisee. Meme
 * regle que pour l'enregistrement des appels — quand le produit accomplit
 * lui-meme l'acte risque, il ne le fait pas en silence.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "routes", "documents.ts"),
  "utf8",
);

/** Le corps de la route de telechargement, isole du reste du fichier. */
function routeTelechargement(): string {
  const i = SOURCE.indexOf('router.get("/documents/:id/download"');
  expect(i).toBeGreaterThan(0);
  return SOURCE.slice(i, i + 4200);
}

describe("le verdict est enfin lu la ou il compte", () => {
  it("la requete selectionne le verdict", () => {
    // Elle ne le faisait pas: impossible d'agir sur une colonne qu'on ne lit
    // pas, et c'est ce qui rendait le defaut invisible.
    expect(routeTelechargement()).toContain("scanVerdict: documentsTable.scanVerdict");
  });

  it("elle selectionne aussi le moteur et le detail", () => {
    // « Dangereux » sans dire pourquoi ni selon quel moteur n'aide personne a
    // decider s'il s'agit d'un faux positif.
    const bloc = routeTelechargement();
    expect(bloc).toContain("scanEngine: documentsTable.scanEngine");
    expect(bloc).toContain("scanDetail: documentsTable.scanDetail");
  });

  it("un fichier juge dangereux est refuse par defaut", () => {
    const bloc = routeTelechargement();
    expect(bloc).toContain('doc.scanVerdict === "dangerous" && !confirme');
    expect(bloc).toContain("status(409)");
  });

  it("le refus dit comment passer outre", () => {
    // Un refus sans issue se contourne par un ticket au support, ou pire: par
    // la desactivation du controle.
    expect(routeTelechargement()).toContain("remediation:");
    expect(routeTelechargement()).toContain("confirme=1");
  });

  it("le refus rend le moteur et le detail a l'appelant", () => {
    const i = routeTelechargement().indexOf("status(409)");
    const bloc = routeTelechargement().slice(i, i + 400);
    expect(bloc).toContain("moteur: doc.scanEngine");
    expect(bloc).toContain("detail: doc.scanDetail");
  });
});

describe("la levee est possible, et tracee", () => {
  it("une confirmation explicite permet le telechargement", () => {
    // Le fichier appartient au client: le lui refuser definitivement serait
    // decider a sa place, et un faux positif est toujours possible.
    expect(routeTelechargement()).toContain('String(req.query.confirme ?? "") === "1"');
  });

  it("la levee est journalisee avec l'utilisateur", () => {
    // La trace compte autant que le refus: c'est elle qui permet de savoir,
    // apres coup, qui a sorti quoi du coffre.
    //
    // UNE MUTATION A SURVECU ICI. La premiere version se contentait de
    // chercher le TEXTE du message: remplacer la condition par `if (false)`
    // laissait le texte en place, le bloc devenait mort, et le test passait
    // toujours. Un test qui verifie la presence d'une chaine ne verifie pas
    // qu'elle est atteignable.
    //
    // On verrouille donc la CONDITION, et son ordre par rapport au message.
    const bloc = routeTelechargement();
    const iCondition = bloc.indexOf('doc.scanVerdict === "dangerous" && confirme');
    expect(iCondition, "le bloc de journalisation n'est plus conditionne au verdict").toBeGreaterThan(0);
    const apres = bloc.slice(iCondition, iCondition + 500);
    expect(apres).toContain("telechargement d'un fichier dangereux confirme");
    expect(apres).toContain("userId: req.session?.userId");
  });

  it("le refus aussi est journalise", () => {
    expect(routeTelechargement()).toContain("telechargement refuse: fichier juge dangereux");
  });

  it("une confirmation autre que « 1 » ne leve pas le refus", () => {
    // `Boolean(req.query.confirme)` aurait accepte n'importe quelle valeur,
    // y compris « false » ou « 0 », qui sont des chaines non vides.
    expect(routeTelechargement()).not.toContain("Boolean(req.query.confirme)");
    expect(routeTelechargement()).toContain('=== "1"');
  });
});

describe("ce qui ne doit PAS etre bloque", () => {
  it("un document non scanne reste telechargeable", () => {
    // La majorite des documents anterieurs a cette fonctionnalite ont un
    // verdict NULL, et le scan de fond n'est pas instantane. Les bloquer
    // rendrait le produit inutilisable pour une menace hypothetique.
    const bloc = routeTelechargement();
    expect(bloc).not.toContain("scanVerdict === null");
    expect(bloc).not.toContain("!doc.scanVerdict");
  });

  it("seul le verdict « dangerous » declenche le refus", () => {
    // Un verdict « safe » ou inconnu passe sans condition.
    const bloc = routeTelechargement();
    const refus = bloc.indexOf("status(409)");
    const avant = bloc.slice(0, refus);
    expect(avant).toContain('"dangerous"');
    expect(avant).not.toContain('"safe"');
  });
});

describe("les protections d'origine sont conservees", () => {
  it("le MIME sniffing reste desactive", () => {
    // Sans `nosniff`, un navigateur peut deduire du HTML/JS d'un fichier
    // declare PDF, et l'executer.
    expect(routeTelechargement()).toContain('"X-Content-Type-Options", "nosniff"');
  });

  it("la CSP restrictive reste posee", () => {
    expect(routeTelechargement()).toContain("default-src 'none'; sandbox");
  });

  it("le fichier reste servi en piece jointe", () => {
    // `attachment` force la sauvegarde plutot qu'un rendu inline.
    expect(routeTelechargement()).toContain("attachment; filename=");
  });

  it("le nom de fichier reste nettoye contre l'injection d'en-tete", () => {
    // Un `\r\n` dans `originalName` permettrait d'injecter un en-tete HTTP.
    expect(routeTelechargement()).toContain('replace(/[\\r\\n"\\\\]/g, "_")');
  });

  it("le telechargement reste borne a l'organisation", () => {
    expect(routeTelechargement()).toContain("eq(documentsTable.organisationId, orgId)");
  });
});
