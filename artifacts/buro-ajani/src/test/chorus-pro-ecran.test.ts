/**
 * L'ecran du raccordement Chorus Pro, et le depot depuis la liste des factures.
 *
 * Le serveur sait deposer une facture sur Chorus Pro ; sans ecran, personne ne
 * peut s'en servir — c'est la lecon de la double authentification, dont les
 * routes existaient depuis des mois sans qu'aucune page ne les appelle.
 *
 * Ce controle porte donc sur ce qui relie l'ecran au serveur : les adresses
 * appelees, les secrets qui ne repartent pas, les libelles dans les six
 * langues, et l'accessibilite des champs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const CARTE = SRC("pages", "settings", "carte-chorus-pro.tsx");
const FACTURES = SRC("pages", "admin-factures-client.tsx");
const ONGLET = SRC("pages", "settings", "tab-plateforme-agreee.tsx");
const LANGUES = ["fr", "en", "es", "de", "tr", "ar"] as const;
const locale = (l: string) =>
  JSON.parse(SRC("i18n", "locales", `${l}.json`)) as Record<string, any>;

describe("la carte est atteignable", () => {
  it("elle est montee dans l'onglet de la facturation electronique", () => {
    expect(ONGLET).toContain("CarteChorusPro");
    expect(ONGLET).toMatch(/import \{ CarteChorusPro \} from ".\/carte-chorus-pro"/);
  });

  it("elle s'affiche meme sans plateforme agreee raccordee", () => {
    // Les deux raccordements sont independants : une entreprise qui ne
    // travaille QUE pour le secteur public doit pouvoir configurer Chorus Pro.
    // Un bloc conditionnel serait plus indente ; six espaces, c'est le niveau
    // du conteneur, donc un rendu inconditionnel.
    // `\r?` : le depot melange les fins de ligne selon l'outil qui a ecrit.
    expect(ONGLET, "la carte est enfermee dans un bloc conditionnel").toMatch(/\n {6}<CarteChorusPro \/>\r?\n/);
  });
});

describe("ce que l'ecran appelle", () => {
  it("les quatre routes du raccordement", () => {
    for (const chemin of ["/api/chorus-pro", "/api/chorus-pro/test", "/api/chorus-pro/suivi", "/api/chorus-pro/structure"]) {
      expect(CARTE, chemin).toContain(chemin);
    }
  });

  it("le depot d'une facture vise la route du serveur", () => {
    expect(FACTURES).toMatch(/\/api\/factures-client\/\$\{f\.id\}\/chorus/);
  });

  it("les adresses proposees sont celles de l'AIFE, production et qualification", () => {
    expect(CARTE).toContain("https://api.piste.gouv.fr/cpro");
    expect(CARTE).toContain("https://oauth.piste.gouv.fr/api/oauth/token");
    expect(CARTE).toContain("https://sandbox-api.piste.gouv.fr/cpro");
    expect(CARTE).toContain("https://sandbox-oauth.piste.gouv.fr/api/oauth/token");
  });

  it("toute requete porte le cookie de session", () => {
    const appels = CARTE.match(/fetch\([^)]*\)/gs) ?? [];
    expect(appels.length).toBeGreaterThanOrEqual(4);
    for (const a of appels) expect(a, a.slice(0, 60)).toContain('credentials: "include"');
  });
});

describe("ce que l'ecran ne fait pas", () => {
  it("il ne reaffiche jamais un secret : la relecture les laisse vides", () => {
    // C'est la RELECTURE qui compte, pas le formulaire vide : le serveur ne
    // rend jamais les secrets, et un ecran qui essaierait de les replacer
    // afficherait « undefined » — ou pire, les afficherait vraiment le jour ou
    // la route deviendrait bavarde.
    const i = CARTE.indexOf("if (d.configure) {");
    expect(i).toBeGreaterThan(0);
    const relecture = CARTE.slice(i, CARTE.indexOf("}", CARTE.indexOf("setForm({", i)));
    expect(relecture).toContain('clientSecret: ""');
    expect(relecture).toContain('motDePasseTechnique: ""');
    expect(relecture, "un secret lu depuis la reponse du serveur").not.toMatch(/clientSecret: (?!"")/);
    expect(relecture, "un mot de passe lu depuis la reponse du serveur").not.toMatch(/motDePasseTechnique: (?!"")/);
  });

  it("les deux secrets sont masques a la saisie", () => {
    const champsMotDePasse = CARTE.match(/id="cpro-(client-secret|mot-de-passe)"[^>]*type="password"/gs) ?? [];
    expect(champsMotDePasse).toHaveLength(2);
  });

  it("une facture deja deposee ne propose plus le depot, sauf si elle est rejetee", () => {
    expect(FACTURES).toMatch(/!f\.chorusNumeroFlux \|\| \/REJET\/i\.test\(f\.chorusEtat \?\? ""\)/);
  });

  it("le depot est confirme avant d'etre fait", () => {
    // Un depot ne s'annule pas : il part chez l'acheteur public.
    const i = FACTURES.indexOf("const handleChorus");
    const corps = FACTURES.slice(i, i + 900);
    // La garde exacte : un refus sort de la fonction. Une condition qui
    // neutraliserait l'appel (`if (false && ...)`) ne correspond plus.
    expect(corps).toContain("if (!(await confirmAction({");
    expect(corps).toMatch(/\}\)\)\) return;/);
    expect(corps.indexOf("confirmAction")).toBeLessThan(corps.indexOf("fetch("));
  });
});

describe("accessibilite", () => {
  it("chaque champ porte une etiquette reliee par son identifiant", () => {
    // Deux formes coexistent : les champs ecrits a la main, et ceux produits
    // par le fabricant `champ(cle, id)`. Les deux doivent relier Label et Input.
    const litteraux = [...CARTE.matchAll(/<Input id="([^"]+)"/g)].map((m) => m[1]!);
    for (const id of litteraux) {
      expect(CARTE, `etiquette de ${id}`).toMatch(new RegExp(`htmlFor="${id}"`));
    }
    const fabriques = [...CARTE.matchAll(/\{champ\("[a-zA-Z]+", "([^"]+)"/g)].map((m) => m[1]!);
    expect(litteraux.length + fabriques.length, "les huit champs du raccordement").toBeGreaterThanOrEqual(8);
    // Le fabricant relie lui-meme l'etiquette a l'identifiant recu.
    expect(CARTE).toMatch(/<Label htmlFor=\{id\}>[\s\S]{0,120}<Input id=\{id\}/);
  });

  it("les aides de saisie sont reliees par aria-describedby", () => {
    for (const aide of ["cpro-secret-aide", "cpro-mdp-aide", "cpro-siret-aide"]) {
      expect(CARTE).toContain(`aria-describedby="${aide}"`);
      expect(CARTE).toContain(`id="${aide}"`);
    }
  });

  it("les boutons d'action de la liste ont un nom qui designe la facture", () => {
    expect(FACTURES).toContain('aria-label={t("adminFacturesClient.chorus.deposerFor", { reference: f.reference })}');
  });

  it("les icones decoratives sont cachees aux lecteurs d'ecran", () => {
    const icones = CARTE.match(/<(Building2|Loader2|RefreshCw|Save|Search|Trash2)[^>]*\/>/g) ?? [];
    expect(icones.length).toBeGreaterThan(5);
    for (const i of icones) expect(i, i).toMatch(/aria-hidden="true"|aria-label=/);
  });
});

describe("les libelles existent dans les six langues", () => {
  const cles = [
    "title", "description", "why", "connected", "save", "test", "suivi", "delete",
    "secretKept", "secretHint", "motDePasseHint", "confirmDelete",
  ];

  for (const l of LANGUES) {
    it(`${l} : la carte`, () => {
      const d = locale(l).settingsChorusPro;
      expect(d, `settingsChorusPro absent en ${l}`).toBeTruthy();
      for (const c of cles) expect(String(d[c] ?? ""), `${l}.${c}`).not.toBe("");
      for (const c of ["urlBase", "urlJeton", "clientId", "clientSecret", "compteTechnique", "motDePasseTechnique", "idUtilisateurCourant", "syntaxeFlux"]) {
        expect(String(d.fields?.[c] ?? ""), `${l}.fields.${c}`).not.toBe("");
      }
    });

    it(`${l} : le depot depuis la liste des factures`, () => {
      const d = locale(l).adminFacturesClient?.chorus;
      expect(d, `adminFacturesClient.chorus absent en ${l}`).toBeTruthy();
      for (const c of ["deposer", "deposerFor", "confirmTitle", "confirmDesc", "sent", "error", "badge"]) {
        expect(String(d[c] ?? ""), `${l}.${c}`).not.toBe("");
      }
      // Les libelles a trou gardent leur variable : sans elle, le message
      // designe « la facture » sans dire laquelle.
      expect(d.deposerFor).toContain("{{reference}}");
      expect(d.confirmDesc).toContain("{{reference}}");
    });
  }
});
