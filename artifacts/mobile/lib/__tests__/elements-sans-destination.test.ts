/**
 * Un element qui a l'air cliquable mene quelque part, et un choix offert est
 * un choix que le serveur accepte.
 *
 * Deux defauts du meme genre, trouves le 24/09/2026 en suivant les ecrans
 * jusqu'a leur effet reel.
 *
 * 1. `app/recherche.tsx` — la recherche serveur rend aussi des devis, des
 *    factures et du stock. Chaque ligne affichait un chevron et poussait vers
 *    « /devis », « /factures » ou « /stock ». Ces trois ecrans n'existent pas
 *    dans `app/` : expo-router tombait sur `+not-found`. L'utilisateur venait
 *    de VOIR son devis dans les resultats et atterrissait sur « Page
 *    introuvable » — de quoi croire que le devis lui-meme a disparu.
 *
 * 2. `app/projets.tsx` — le menu des priorites proposait « critique ». La
 *    route n'accepte que haute/moyenne/basse et repond 400 « Priorite
 *    invalide ». Le projet n'etait pas cree, et l'ecran ne disait pas
 *    pourquoi.
 *
 * Le controle derive les listes DES SOURCES (ecrans presents dans `app/`,
 * priorites acceptees par la route) plutot que de les recopier : une liste
 * recopiee ne protege que ce qu'on a pense a y mettre.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dirname, "..", "..", "app");
const ROUTES = join(import.meta.dirname, "..", "..", "..", "api-server", "src", "routes");

const RECHERCHE = readFileSync(join(APP, "recherche.tsx"), "utf8");
const PROJETS = readFileSync(join(APP, "projets.tsx"), "utf8");

/** Les ecrans reellement presents, tels qu'expo-router les resout. */
function ecransExistants(): Set<string> {
  const noms = new Set<string>();
  for (const f of readdirSync(APP, { withFileTypes: true })) {
    if (f.isDirectory()) {
      // Un groupe `(tabs)` n'apparait pas dans l'URL : ses ecrans sont a la racine.
      if (f.name.startsWith("(")) {
        for (const g of readdirSync(join(APP, f.name))) {
          if (g.endsWith(".tsx") && !g.startsWith("_")) noms.add("/" + g.replace(/\.tsx$/, ""));
        }
      } else noms.add("/" + f.name);
      continue;
    }
    if (f.name.endsWith(".tsx") && !f.name.startsWith("_") && !f.name.startsWith("+")) {
      noms.add("/" + f.name.replace(/\.tsx$/, ""));
    }
  }
  return noms;
}

/** Les destinations declarees par les categories de la recherche. */
function destinationsDeclarees(): string[] {
  return [...RECHERCHE.matchAll(/route: "([^"]+)"/g)].map((m) => m[1]!);
}

/** Les priorites que la route des projets accepte. */
function prioritesAcceptees(): string[] {
  const source = readFileSync(join(ROUTES, "projets.ts"), "utf8");
  const m = source.match(/const PRIORITIES = \[([^\]]+)\]/);
  return m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
}

/** Les valeurs offertes par le menu `priority` de l'ecran des projets. */
function prioritesOffertes(): string[] {
  const i = PROJETS.indexOf(`key: "priority"`);
  if (i < 0) return [];
  const debut = PROJETS.indexOf("options: [", i);
  const fin = PROJETS.indexOf("],", debut);
  return [...PROJETS.slice(debut, fin).matchAll(/value: "([^"]+)"/g)].map((m) => m[1]!);
}

describe("le releve mesure bien quelque chose", () => {
  it("des ecrans sont trouves dans app/", () => {
    // Un dossier deplace rendrait un ensemble vide, et un ensemble vide
    // declarerait toutes les destinations mortes — ou toutes vivantes.
    expect(ecransExistants().size).toBeGreaterThan(20);
  });

  it("la recherche declare encore des destinations", () => {
    expect(destinationsDeclarees().length).toBeGreaterThan(3);
  });

  it("la route des projets declare encore des priorites", () => {
    expect(prioritesAcceptees().length).toBeGreaterThan(1);
  });

  it("l'ecran des projets offre encore des priorites", () => {
    expect(prioritesOffertes().length).toBeGreaterThan(1);
  });
});

describe("la recherche ne pousse que vers des ecrans qui existent", () => {
  it("chaque destination declaree correspond a un ecran", () => {
    const existants = ecransExistants();
    const mortes = destinationsDeclarees().filter((r) => !existants.has(r));
    expect(mortes, "expo-router renverrait sur « Page introuvable »").toEqual([]);
  });

  it("les trois anciennes impasses ont bien disparu", () => {
    // Nommees, parce que ce sont celles qui existaient : si l'une revenait,
    // le controle general au-dessus la prendrait, mais autant le dire ici.
    for (const morte of ['route: "/devis"', 'route: "/factures"', 'route: "/stock"']) {
      expect(RECHERCHE).not.toContain(morte);
    }
  });

  it("les categories sans destination restent affichees", () => {
    // Le correctif ne doit pas faire disparaitre les resultats : un devis
    // trouve reste un devis trouve, il ne se donne simplement plus pour un lien.
    for (const clef of ['key: "devis"', 'key: "factures"', 'key: "stock"']) {
      expect(RECHERCHE).toContain(clef);
    }
  });

  it("la destination est facultative dans le type", () => {
    expect(RECHERCHE).toMatch(/route\?: string;/);
  });
});

describe("rien ne se donne pour cliquable sans l'etre", () => {
  it("la ligne de resultat n'appelle la navigation que si elle a une destination", () => {
    expect(RECHERCHE).toMatch(/onPress=\{cat\.route \?/);
  });

  it("elle est desactivee quand il n'y a nulle part ou aller", () => {
    expect(RECHERCHE).toMatch(/disabled=\{!cat\.route\}/);
  });

  it("le role annonce ne promet un bouton que s'il y en a un", () => {
    // Un lecteur d'ecran qui annonce « bouton » sur une ligne inerte ment
    // deux fois : a l'oeil et a l'oreille.
    expect(RECHERCHE).toMatch(/accessibilityRole=\{cat\.route \? "button" : "text"\}/);
  });

  it("le chevron — la promesse d'un ailleurs — disparait avec la destination", () => {
    expect(RECHERCHE).toMatch(/\{cat\.route \? <Feather name="chevron-right"/);
  });

  it("la grille de depart ne propose que des ecrans atteignables", () => {
    expect(RECHERCHE).toMatch(/CATEGORIES\.filter\(cat => cat\.route\)\.map/);
  });
});

describe("le menu n'ouvre pas une porte fermee", () => {
  const PLUS = readFileSync(join(APP, "(tabs)", "more.tsx"), "utf8");
  const GARDE = 'user?.role === "administrateur"';

  /**
   * Les trois lignes qui precedent la ligne de menu menant a un ecran.
   *
   * Trois, parce que c'est la distance maximale entre une entree et la
   * condition qui l'entoure — ouverture de section et titre compris. Une
   * fenetre plus large attraperait la garde de l'entree VOISINE et
   * declarerait gardee une entree qui ne l'est pas.
   */
  function entree(chemin: string): string {
    const lignes = PLUS.split(/\r?\n/);
    const i = lignes.findIndex((l) => l.includes(`nav("${chemin}")`));
    return i < 0 ? "" : lignes.slice(Math.max(0, i - 3), i).join("\n");
  }

  it("le releve retrouve bien les entrees visees", () => {
    // Un menu restructure rendrait des chaines vides, satisfaites par tout.
    for (const c of ["/reports", "/admin-reports", "/recherche"]) {
      expect(entree(c), `entree ${c} introuvable`).not.toBe("");
    }
  });

  it("« Rapports / Tickets » est reserve aux roles qui peuvent s'en servir", () => {
    // GET et POST /api/admin-reports repondent 403 a tout autre role :
    // l'ecran s'ouvrait vide et le formulaire echouait, sans un mot.
    expect(entree("/reports")).toContain(GARDE);
  });

  it("« Mon espace » l'etait deja — c'est la meme API", () => {
    expect(entree("/admin-reports")).toContain(GARDE);
  });

  it("les deux ecrans interrogent bien la meme route", () => {
    // S'ils divergeaient, la comparaison de roles ci-dessus ne voudrait rien
    // dire : c'est elle qui rend les deux gardes comparables.
    for (const f of ["reports.tsx", "admin-reports.tsx"]) {
      expect(readFileSync(join(APP, f), "utf8")).toContain("/api/admin-reports");
    }
  });

  it("la route, elle, reserve bien l'acces — sinon la garde d'ecran serait de trop", () => {
    const route = readFileSync(join(ROUTES, "admin-reports.ts"), "utf8");
    expect(route).toContain("Acces reserve aux administrateurs.");
  });

  it("une entree ouverte a tous ne mene pas a une route reservee", () => {
    // Contre-exemple : la recherche est ouverte, et sa route l'est aussi.
    expect(entree("/recherche")).not.toContain(GARDE);
  });
});

describe("le menu des priorites ne propose que des valeurs acceptees", () => {
  it("chaque priorite offerte est acceptee par la route", () => {
    const acceptees = prioritesAcceptees();
    const refusees = prioritesOffertes().filter((p) => !acceptees.includes(p));
    expect(refusees, "ces choix repondraient 400 « Priorite invalide »").toEqual([]);
  });

  it("« critique » n'est plus offerte", () => {
    expect(prioritesOffertes()).not.toContain("critique");
  });

  it("et la route ne l'a jamais acceptee — c'est bien l'ecran qui mentait", () => {
    expect(prioritesAcceptees()).not.toContain("critique");
  });

  it("les trois priorites reelles restent offertes", () => {
    // Le correctif ne doit pas avoir retire plus que le choix mort.
    expect(prioritesOffertes().sort()).toEqual(["basse", "haute", "moyenne"]);
  });

  it("l'affichage ne garde pas de couleur pour une priorite impossible", () => {
    // Une entree « critique » dans la table des couleurs ferait croire que la
    // valeur existe encore quelque part.
    const i = PROJETS.indexOf("const PRIORITY_COLORS");
    const bloc = PROJETS.slice(i, PROJETS.indexOf("\n};", i));
    expect(bloc).not.toContain("critique");
  });

  it("ni de libelle", () => {
    const i = PROJETS.indexOf("const PRIORITY_LABEL_KEYS");
    const bloc = PROJETS.slice(i, PROJETS.indexOf("\n};", i));
    expect(bloc).not.toContain("critique");
  });
});
