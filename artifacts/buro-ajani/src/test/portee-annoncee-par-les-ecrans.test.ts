/**
 * Un ecran n'annonce pas un role ni une portee qu'il n'a pas.
 *
 * Les ecrans `/devis` et `/factures` sont les ecrans CLIENT : dans `App.tsx`
 * ils ne portent qu'une garde de licence, pas de garde de role. Ils
 * affichaient pourtant, en haut de page, un badge rouge « Super-admin » et
 * annoncaient en sous-titre une « vue globale SaaS — toutes organisations
 * confondues ».
 *
 * Trois mensonges en un seul bandeau :
 *
 *  - le ROLE : la page est ouverte a tout utilisateur licencie ;
 *  - la PORTEE : `GET /api/devis` et `GET /api/factures-client` bornent leur
 *    requete a `getOrgId(req)` ; aucune ligne d'une autre organisation n'est
 *    lue, ni ne peut l'etre ;
 *  - la COULEUR : un badge rouge « bouclier » est un signal d'alerte.
 *
 * Le cout n'est pas cosmetique. Un client qui ouvre ses propres devis y lit
 * qu'il regarde les donnees de toutes les organisations — donc que les
 * siennes sont visibles ailleurs. C'est exactement la phrase qui fait perdre
 * un client, et exactement celle qu'un acheteur du logiciel relevera.
 *
 * Ces controles lisent la source : ils verrouillent le MOTIF (un badge de
 * role sur un ecran sans garde de role), pas seulement les deux occurrences
 * d'hier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");
const APP = readFileSync(join(SRC, "App.tsx"), "utf8");
const FR = JSON.parse(readFileSync(join(SRC, "i18n", "locales", "fr.json"), "utf8"));

/** Les ecrans client : routes montees SANS garde de role. */
const ECRANS_CLIENT = [
  { chemin: "/devis", fichier: "admin-devis.tsx", bloc: "adminDevis" },
  { chemin: "/factures", fichier: "admin-factures-client.tsx", bloc: "adminFacturesClient" },
] as const;

function source(fichier: string): string {
  return readFileSync(join(SRC, "pages", fichier), "utf8");
}

/** La ligne de montage d'une route dans App.tsx. */
function montage(chemin: string): string {
  const m = APP.match(new RegExp(`<Route path="${chemin}"[^/]*/>`));
  return m?.[0] ?? "";
}

describe("le releve mesure bien quelque chose", () => {
  it("les deux routes sont bien montees dans App.tsx", () => {
    // Une route renommee rendrait une chaine vide, et une chaine vide ne
    // contient jamais « withRoleGate » : le controle passerait au vert.
    for (const e of ECRANS_CLIENT) expect(montage(e.chemin), `route ${e.chemin} introuvable`).not.toBe("");
  });

  it("App.tsx pose bien des gardes de role ailleurs", () => {
    // Si plus personne n'utilise withRoleGate, la comparaison ne dit plus rien.
    expect(APP.match(/withRoleGate\(/g)?.length ?? 0).toBeGreaterThan(3);
  });

  it("les deux blocs de traduction existent", () => {
    for (const e of ECRANS_CLIENT) expect(FR[e.bloc], `bloc ${e.bloc} absent`).toBeTruthy();
  });
});

describe("ces ecrans sont bien des ecrans client", () => {
  it.each(ECRANS_CLIENT.map((e) => [e.chemin, e] as const))("%s n'a pas de garde de role", (_c, e) => {
    expect(montage(e.chemin), "si une garde de role apparait, le badge redevient legitime").not.toContain("withRoleGate");
  });

  it.each(ECRANS_CLIENT.map((e) => [e.chemin, e] as const))("%s a bien une garde de licence", (_c, e) => {
    expect(montage(e.chemin)).toContain("withLicenseGate");
  });

  it("les vrais ecrans super-admin, eux, sont gardes", () => {
    // Contre-exemple : si ce controle-ci tombait, c'est la lecture de
    // App.tsx qui serait fausse, pas le badge.
    for (const chemin of ["/admin/dashboard", "/admin/audit", "/admin/factures-b2b"]) {
      expect(montage(chemin), `${chemin} devrait etre garde`).toContain("withRoleGate");
    }
  });
});

describe("aucun des deux n'annonce un role qu'il n'a pas", () => {
  it.each(ECRANS_CLIENT.map((e) => [e.fichier, e] as const))("%s n'affiche plus de badge de role", (_f, e) => {
    expect(source(e.fichier)).not.toContain(`t("${e.bloc}.superAdmin")`);
  });

  it.each(ECRANS_CLIENT.map((e) => [e.fichier, e] as const))("%s n'a plus de badge rouge « bouclier »", (_f, e) => {
    // Le motif, pas l'occurrence : bouclier + rouge en tete de page.
    expect(source(e.fichier)).not.toMatch(/<Badge[^>]*text-red-700[\s\S]{0,200}?<Shield/);
  });

  it("la clef de traduction du badge a disparu, dans toutes les langues", () => {
    // Une clef laissee derriere fait croire au traducteur suivant qu'un badge
    // existe encore, et le fait revenir.
    const dossier = join(SRC, "i18n", "locales");
    for (const fichier of ["fr.json", "en.json", "tr.json", "de.json", "es.json", "ar.json"]) {
      const j = JSON.parse(readFileSync(join(dossier, fichier), "utf8"));
      for (const e of ECRANS_CLIENT) {
        expect(j[e.bloc]?.superAdmin, `${fichier} : ${e.bloc}.superAdmin subsiste`).toBeUndefined();
      }
    }
  });
});

describe("aucun des deux n'annonce une portee qu'il n'a pas", () => {
  it.each(ECRANS_CLIENT.map((e) => [e.bloc, e] as const))("%s : le sous-titre ne parle plus de toutes les organisations", (_b, e) => {
    expect(FR[e.bloc].subtitle.toLowerCase()).not.toContain("toutes organisations");
    expect(FR[e.bloc].subtitle.toLowerCase()).not.toContain("organisations confondues");
  });

  it.each(ECRANS_CLIENT.map((e) => [e.bloc, e] as const))("%s : ni de « vue globale SaaS »", (_b, e) => {
    expect(FR[e.bloc].subtitle.toLowerCase()).not.toContain("vue globale");
  });

  it("et les routes serveur bornent bien a l'organisation de la session", () => {
    // La raison pour laquelle l'annonce etait fausse : sans cette borne, le
    // sous-titre aurait ete vrai — et le probleme, bien plus grave.
    const routes = join(import.meta.dirname, "..", "..", "..", "api-server", "src", "routes");
    for (const [fichier, table] of [["devis.ts", "devisTable"], ["factures-client.ts", "facturesClientTable"]] as const) {
      const s = readFileSync(join(routes, fichier), "utf8");
      expect(s, `${fichier} : pas de borne tenant`).toContain(`eq(${table}.organisationId, orgId)`);
    }
  });

  it("le titre des devis ne melange plus deux langues", () => {
    // « Devis kurumsal » : moitie francais, moitie turc, dans l'interface
    // francaise. Un detail, mais c'est la premiere ligne de l'ecran.
    expect(FR.adminDevis.title).not.toMatch(/kurumsal/i);
  });

  it("les deux ecrans gardent un titre et un sous-titre", () => {
    // Le correctif ne doit pas avoir vide le bandeau.
    for (const e of ECRANS_CLIENT) {
      expect(FR[e.bloc].title?.length ?? 0).toBeGreaterThan(2);
      expect(FR[e.bloc].subtitle?.length ?? 0).toBeGreaterThan(10);
    }
  });
});

describe("le motif, au-dela de ces deux ecrans", () => {
  /**
   * Les ecrans montes sans garde de role, et ceux qu'on n'a pas pu lire.
   *
   * On rend les DEUX, parce qu'une liste de fautifs vide ne veut dire
   * « aucun fautif » que si l'on a vraiment regarde. Une regex qui ne mord
   * plus, un fichier introuvable, un import renomme : le releve devient
   * silencieux et le controle passe au vert sans avoir rien mesure.
   * (Distinction rapportee par la session Kaverd le 24/09/2026 : son audit a
   * declare « pas de declencheur Cloud Build » alors que la region qui le
   * portait n'avait simplement pas pu etre lue.)
   */
  function ecransSansGardeDeRole(): { fautifs: string[]; examines: string[]; illisibles: string[] } {
    const fautifs: string[] = [];
    const examines: string[] = [];
    const illisibles: string[] = [];
    for (const m of APP.matchAll(/<Route path="([^"]+)" component=\{with(\w+)Gate\((\w+)/g)) {
      const [, chemin, garde, composant] = m;
      if (garde === "Role") continue;
      const lazy = APP.match(new RegExp(`const ${composant} = lazy\\(\\(\\) => import\\("@/pages/([^"]+)"\\)`));
      if (!lazy) { illisibles.push(`${chemin} : import de ${composant} introuvable`); continue; }
      let s: string;
      try { s = source(`${lazy[1]}.tsx`); } catch { illisibles.push(`${chemin} : ${lazy[1]}.tsx illisible`); continue; }
      examines.push(`${chemin} (${lazy[1]})`);
      if (/superAdmin"\)/.test(s)) fautifs.push(`${chemin} (${lazy[1]})`);
    }
    return { fautifs, examines, illisibles };
  }

  it("le releve examine vraiment des ecrans", () => {
    // Le garde-fou du controle suivant : sans lui, une liste vide de fautifs
    // ne distingue pas « tout va bien » de « on n'a rien regarde ».
    expect(ecransSansGardeDeRole().examines.length).toBeGreaterThan(5);
  });

  it("et il a pu tous les lire — sinon il ne conclut pas", () => {
    const { illisibles } = ecransSansGardeDeRole();
    expect(illisibles, "ces ecrans n'ont pas ete mesures : l'absence de faute ne prouve rien ici").toEqual([]);
  });

  it("aucun ecran monte sans garde de role n'affiche de badge super-admin", () => {
    // La regle generale : c'est elle qui empeche le defaut de revenir par un
    // troisieme ecran.
    expect(ecransSansGardeDeRole().fautifs, "badge super-admin sur un ecran ouvert aux clients").toEqual([]);
  });
});
