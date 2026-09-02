import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La demo publique doit avoir un maximum absolu, pas seulement par visiteur.
 *
 * Cette page appelle un modele payant, sans authentification, et avec
 * `orgId: null` — donc hors de toute comptabilite de quota client. Sa seule
 * protection etait une limite de 20 messages par heure et PAR IP: elle borne
 * un visiteur, pas la depense. Trente adresses la multiplient par trente, et
 * l'en-tete d'IP est lui-meme fourni par l'appelant sur le chemin direct vers
 * l'API.
 *
 * Rien ne bornait donc la facture IA qu'une page publique peut engendrer.
 *
 * Ce n'est pas une inquietude abstraite: le 2026-09-01, les credits Gemini
 * puis OpenAI se sont epuises et toutes les fonctions IA de l'application se
 * sont arretees. Vider un compte de fournisseur est exactement ce qu'une page
 * publique sans plafond permet de faire, volontairement cette fois.
 *
 * Le plafond est en memoire, donc par instance: le maximum reel vaut
 * `MAX x instances`. C'est assume — ce qui compte est qu'un maximum existe et
 * que le depassement rende la reponse de repli au lieu d'appeler le modele.
 */

const ROUTE = path.resolve(
  import.meta.dirname, "..", "routes", "public-demo-chat.ts",
);
const source = fs.readFileSync(ROUTE, "utf8");

describe("plafond de la demo publique", () => {
  it("existe, en plus de la limite par IP", () => {
    expect(source).toContain("DEMO_GLOBAL_MAX_PER_HOUR");
    expect(source, "la limite par IP seule ne borne pas la depense").toContain("demoBudgetAvailable");
  });

  it("est verifie AVANT l'appel au modele", () => {
    // Un plafond controle apres coup ne protege rien: la depense est deja
    // engagee.
    // Le site D APPEL, pas la definition: chercher le nom seul trouverait
    // la fonction elle-meme, plus haut dans le fichier, et le test passerait
    // sans rien verifier.
    const guard = source.indexOf("if (!demoBudgetAvailable())");
    const call = source.indexOf("generateText({");

    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(guard, "le plafond doit preceder l'appel payant").toBeLessThan(call);
  });

  it("ne consomme pas de budget sur une requete invalide", () => {
    // La validation du message doit rester avant le compteur, sinon un flot de
    // requetes vides suffirait a fermer la demo pour les vrais visiteurs.
    const validation = source.indexOf("Posez une question pour demarrer la demo.");
    const guard = source.indexOf("if (!demoBudgetAvailable())");

    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(guard);
  });

  it("rend la reponse de repli au lieu d'une erreur", () => {
    // La demo est une vitrine commerciale: au plafond elle doit rester
    // presentable, simplement sans depenser.
    const guardBlock = source.slice(
      source.indexOf("if (!demoBudgetAvailable())"),
      source.indexOf("try {", source.indexOf("if (!demoBudgetAvailable())")),
    );

    expect(guardBlock).toContain("DEMO_FALLBACK_REPLY");
    expect(guardBlock).toContain("degraded: true");
  });

  it("reste reglable sans redeploiement", () => {
    // Le bon chiffre depend du trafic reel; il doit pouvoir bouger vite si la
    // demo devient populaire ou si une fraude commence.
    expect(source).toContain("PUBLIC_DEMO_MAX_PER_HOUR");
  });
});
