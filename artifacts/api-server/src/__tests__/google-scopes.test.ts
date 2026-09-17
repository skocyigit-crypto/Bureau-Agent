/**
 * Le produit demandait le droit de supprimer le courrier, et ne s'en servait pas.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * Scope demande : `gmail.modify` — lire, MODIFIER et SUPPRIMER le courrier.
 * Inventaire de ce que le produit en fait, sur tout le depot :
 *
 *     getProfile, labels.list, messages.list, messages.get,
 *     messages.attachments, messages.send, threads.get
 *
 * Aucun `messages.modify`, aucun changement d'etiquette, aucune mise a la
 * corbeille — ni via la bibliotheque cliente, ni en REST brut (verifie
 * separement, apres s'etre fait prendre une premiere fois sur Drive ou les
 * appels passent en REST et echappaient au premier comptage).
 *
 * CE QUE LE RESSERREMENT CHANGE, ET CE QU'IL NE CHANGE PAS
 *
 * `gmail.modify` et `gmail.readonly` sont tous deux des « restricted scopes »:
 * l'evaluation de securite CASA, renouvelee chaque annee, reste due. Le
 * resserrement ne l'evite pas, et pretendre le contraire serait faux.
 *
 * Ce qu'il change : l'ecran de consentement cesse de demander le droit de
 * supprimer le courrier, et un jeton compromis ne permet plus de le faire.
 * Minimisation (RGPD art. 5.1.c) et reduction du rayon d'explosion.
 *
 * LA VRAIE DIFFICULTE : NE PAS DECONNECTER LES UTILISATEURS EXISTANTS
 *
 * Ceux qui sont deja connectes ont accorde `gmail.modify`. Le controle qui
 * decide si un service est connecte comparait le scope requis au scope accorde
 * par EGALITE STRICTE. Resserrer la demande sans toucher a ce controle aurait
 * affiche « Gmail non connecte » a tous ces utilisateurs, dont le jeton
 * fonctionne parfaitement.
 *
 * C'est la moitie du travail, et la moitie qu'on oublie.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import {
  SCOPE_GMAIL_MODIFY,
  SCOPE_GMAIL_READONLY,
  SCOPE_GMAIL_SEND,
  scopeSatisfait,
  serviceConnecte,
} from "../services/google-scopes";

const CALENDAR = "https://www.googleapis.com/auth/calendar";

describe("l'englobement reconnait les autorisations deja accordees", () => {
  it("gmail.modify satisfait gmail.readonly", () => {
    // LE CAS QUI EVITE UNE REGRESSION DE MASSE.
    expect(scopeSatisfait(SCOPE_GMAIL_READONLY, [SCOPE_GMAIL_MODIFY])).toBe(true);
  });

  it("gmail.modify satisfait aussi gmail.send", () => {
    expect(scopeSatisfait(SCOPE_GMAIL_SEND, [SCOPE_GMAIL_MODIFY])).toBe(true);
  });

  it("le scope historique mail.google.com satisfait les deux", () => {
    // Certains comptes anciens portent le scope complet de Gmail.
    expect(scopeSatisfait(SCOPE_GMAIL_READONLY, ["https://mail.google.com/"])).toBe(true);
    expect(scopeSatisfait(SCOPE_GMAIL_SEND, ["https://mail.google.com/"])).toBe(true);
  });

  it("un scope identique se satisfait lui-meme", () => {
    expect(scopeSatisfait(CALENDAR, [CALENDAR])).toBe(true);
  });

  it("l'englobement ne fonctionne PAS dans l'autre sens", () => {
    // gmail.readonly ne donne pas le droit de modifier: si le produit venait
    // a en avoir besoin, il ne doit pas croire l'avoir deja.
    expect(scopeSatisfait(SCOPE_GMAIL_MODIFY, [SCOPE_GMAIL_READONLY])).toBe(false);
  });

  it("un scope sans rapport ne satisfait rien", () => {
    expect(scopeSatisfait(SCOPE_GMAIL_READONLY, [CALENDAR])).toBe(false);
    expect(scopeSatisfait(CALENDAR, [SCOPE_GMAIL_MODIFY])).toBe(false);
  });

  it("une liste vide ne satisfait rien", () => {
    expect(scopeSatisfait(SCOPE_GMAIL_READONLY, [])).toBe(false);
  });
});

describe("un service est connecte quand TOUS ses scopes sont couverts", () => {
  it("gmail exige la lecture ET l'envoi", () => {
    // Un seul des deux ne suffit pas: le produit lit et envoie.
    expect(serviceConnecte([SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND], [SCOPE_GMAIL_READONLY])).toBe(false);
    expect(serviceConnecte([SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND], [SCOPE_GMAIL_SEND])).toBe(false);
  });

  it("les deux scopes accordes separement suffisent", () => {
    expect(
      serviceConnecte([SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND], [SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND]),
    ).toBe(true);
  });

  it("un utilisateur historique avec gmail.modify reste connecte", () => {
    // LE TEST QUI COMPTE. Sans l'englobement, ce cas rendrait `false` et
    // l'interface annoncerait une deconnexion qui n'a pas eu lieu.
    expect(serviceConnecte([SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND], [SCOPE_GMAIL_MODIFY])).toBe(true);
  });

  it("des scopes surnumeraires ne genent pas", () => {
    expect(
      serviceConnecte([CALENDAR], [CALENDAR, SCOPE_GMAIL_MODIFY, "https://www.googleapis.com/auth/drive"]),
    ).toBe(true);
  });

  it("un service sans scope requis n'est jamais connecte", () => {
    // Rendre `true` sur une liste vide declarerait connecte un service
    // inexistant.
    expect(serviceConnecte([], [SCOPE_GMAIL_MODIFY])).toBe(false);
  });
});

describe("ce que le produit demande desormais", () => {
  it("gmail.modify n'est plus demande", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "google-oauth.ts"), "utf8");
    const i = source.indexOf("const GOOGLE_SCOPES_MAP");
    const carte = source.slice(i, i + 1200);
    expect(carte).not.toContain("gmail.modify");
    expect(carte).toContain("SCOPE_GMAIL_READONLY");
    expect(carte).toContain("SCOPE_GMAIL_SEND");
  });

  it("le controle de connexion utilise l'englobement, pas l'egalite", async () => {
    // C'est la ligne qui aurait deconnecte tout le monde.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "google-oauth.ts"), "utf8");
    expect(source).toContain("serviceConnecte(requiredScopes, grantedScopes)");
    expect(/grantedScopes\.includes\(requiredScope\)/.test(source)).toBe(false);
  });

  it("la seconde declaration de scope est alignee", async () => {
    // Le meme scope etait declare a deux endroits. Deux listes pour la meme
    // question finissent par diverger — c'est le defaut le plus repete de cet
    // audit.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "workspace.ts"), "utf8");
    expect(source).not.toContain("gmail.modify");
  });

  it("drive reste large, et c'est assume", async () => {
    // L'ecriture Drive est REELLEMENT utilisee par les sauvegardes. Resserrer
    // demanderait de separer sauvegardes (drive.file) et navigateur de
    // fichiers (Picker): un changement de fonctionnalite, pas de constante.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "google-oauth.ts"), "utf8");
    expect(source).toContain('drive: ["https://www.googleapis.com/auth/drive"]');
  });
});
