/**
 * Une commande qui a l'air d'un reglage doit en etre un.
 *
 * L'ecran de securite portait trois familles de commandes decoratives :
 *
 *  - six interrupteurs « Conformite RGPD » (chiffrement au repos, journal
 *    d'audit, droit a l'oubli, export des donnees, conservation limitee,
 *    consentement explicite), tous affiches ACTIFS, tous en
 *    `<Switch defaultChecked />` sans etat ni handler. On pouvait les
 *    basculer ; rien n'etait lu, rien n'etait envoye, et au rendu suivant ils
 *    repassaient tous a « actif ». C'est l'endroit du produit ou il faut le
 *    moins broder : un acheteur, ou un delegue a la protection des donnees,
 *    lit cet ecran comme une preuve de conformite.
 *
 *  - quatre « actions de securite » — audit complet, export du journal,
 *    revocation des sessions, verrouillage d'urgence — qui appelaient toutes
 *    `handleSecurityAction`, une fonction qui AFFICHAIT une phrase et
 *    s'arretait la. « Verrouillage d'urgence active. Seul le super admin peut
 *    deverrouiller. » Un administrateur qui vient de decouvrir une
 *    compromission lit cette phrase, la croit, et ne fait rien de plus.
 *
 *  - trois reglages (Zero Trust, re-authentification, expiration de session)
 *    qui n'etaient que des `useState` locaux, perdus au changement d'onglet.
 *
 * Ce qui existait vraiment a ete branche (export du journal, revocation des
 * sessions) ; le reste a ete retire. Un reglage absent se remarque et se
 * reclame ; un reglage qui ment ne se remarque jamais.
 *
 * Ces controles lisent la SOURCE. Ils ne prouvent pas le rendu, mais ils
 * verrouillent le MOTIF — un interrupteur sans etat — et pas seulement les
 * lignes d'hier.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PAGES = join(import.meta.dirname, "..", "pages");

/**
 * Le code, commentaires retires.
 *
 * Premiere version de ce controle : il comptait les `<Switch>` cites dans les
 * COMMENTAIRES qui expliquent pourquoi on les a enleves — donc il criait au
 * loup sur la correction elle-meme. Un controle qui crie au loup finit
 * desactive, et c'est le vrai defaut qui passe ensuite.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")   // commentaires JSX
    .replace(/\/\*[\s\S]*?\*\//g, "")       // blocs de commentaire
    .replace(/^\s*\/\/.*$/gm, "");          // lignes de commentaire
}

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".tsx") && !p.includes(".test.") ? [p] : [];
  });
}

/**
 * Les interrupteurs sans etat, `fichier.tsx:ligne`.
 *
 * Un `<Switch>` sans `checked` ET sans `onCheckedChange` ne peut rien
 * enregistrer : il affiche une position et l'oublie. `defaultChecked` est la
 * forme la plus trompeuse, puisqu'il affiche « actif ».
 */
function interrupteursSansEtat(): string[] {
  const out: string[] = [];
  for (const f of fichiers(PAGES)) {
    const lignes = sansCommentaires(readFileSync(f, "utf8")).split(/\r?\n/);
    lignes.forEach((l, i) => {
      const m = /<Switch([^>]*)\/?>/.exec(l);
      if (!m) return;
      const attrs = m[1] ?? "";
      if (/checked=/.test(attrs) || /onCheckedChange=/.test(attrs)) return;
      out.push(`${f.split(/[\\/]/).slice(-1)[0]}:${i + 1}`);
    });
  }
  return out.sort();
}

describe("aucun interrupteur ne fait semblant", () => {
  it("le balayage trouve bien des interrupteurs a controler", () => {
    // Sans ce garde-fou, un motif devenu introuvable ferait passer
    // l'assertion suivante sans rien garantir.
    const total = fichiers(PAGES)
      .map((f) => (sansCommentaires(readFileSync(f, "utf8")).match(/<Switch/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(total, "plus aucun <Switch> detecte: la detection est cassee").toBeGreaterThan(10);
  });

  it("chacun porte un etat et un gestionnaire", () => {
    const muets = interrupteursSansEtat();
    expect(
      muets,
      `interrupteur sans etat — il affiche une position et l'oublie: ${muets.join(", ")}`,
    ).toEqual([]);
  });
});

describe("les actions de securite font ce qu'elles annoncent", () => {
  const source = sansCommentaires(readFileSync(join(PAGES, "settings", "tab-securite.tsx"), "utf8"));

  it("plus aucune action ne se contente d'un message", () => {
    // `handleSecurityAction` affichait une phrase et ne faisait rien. Son
    // retour ramenerait les quatre mensonges d'un coup.
    expect(source).not.toMatch(/handleSecurityAction/);
  });

  it("l'export du journal telecharge vraiment le fichier", () => {
    expect(source).toMatch(/exporterJournalAudit/);
    expect(source, "l'export ne vise pas la route qui rend le CSV")
      .toMatch(/\$\{AUDIT_API\}\/export\/csv/);
  });

  it("la revocation des sessions appelle le serveur", () => {
    expect(source).toMatch(/\$\{AUTH_API\}\/sessions\/revoke-all/);
    expect(source).toMatch(/method: "POST"/);
  });

  it("et elle demande confirmation avant de couper", () => {
    // Elle coupe la session de l'appelant elle-meme: ce n'est pas un clic
    // qu'on laisse partir par inadvertance.
    const bloc = source.slice(source.indexOf("revoquerToutesLesSessions"));
    expect(bloc.slice(0, 700)).toMatch(/confirmAction\(/);
  });

  it("son echec est dit, pas avale", () => {
    const bloc = source.slice(source.indexOf("revoquerToutesLesSessions"), source.indexOf("revoquerToutesLesSessions") + 1400);
    expect(bloc).toMatch(/revokeSessionsFailed/);
  });

  it("les deux commandes qui ne menaient nulle part ont disparu", () => {
    // « Verrouillage d'urgence » n'existe pas cote serveur; « Audit complet »
    // renvoyait a une page reservee au super-administrateur, donc fermee a
    // celui qui voyait le bouton.
    expect(source).not.toMatch(/emergencyLock/);
    expect(source).not.toMatch(/auditFull/);
  });
});

describe("les reglages affiches sont des reglages", () => {
  const source = sansCommentaires(readFileSync(join(PAGES, "settings", "tab-securite.tsx"), "utf8"));

  it("les trois faux reglages ont ete retires", () => {
    for (const mort of ["zeroTrustMode", "forceReauth", "sessionTimeout"]) {
      expect(source, `${mort} est revenu sans enregistrement`).not.toMatch(new RegExp(`\\b${mort}\\b`));
    }
  });

  it("la carte RGPD ne se presente plus comme reglable", () => {
    const debut = source.indexOf("rgpdTitle");
    const bloc = source.slice(debut, debut + 2500);
    expect(bloc, "un interrupteur est revenu sur la carte RGPD").not.toMatch(/<Switch/);
  });

  it("elle renvoie la ou la chose se fait vraiment", () => {
    expect(source).toMatch(/setLocation\("\/protection-donnees"\)/);
  });

  it("les libelles retires ne trainent plus dans les six langues", () => {
    // Une cle orpheline reapparait dans le produit des que quelqu'un la
    // rebranche « puisqu'elle existe ».
    for (const langue of ["fr", "en", "es", "de", "tr", "ar"]) {
      const json = JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "i18n", "locales", `${langue}.json`), "utf8"),
      );
      const app = json.settingsSecurite?.app ?? {};
      for (const mort of ["emergencyLock", "auditFull", "securityAction"]) {
        expect(app[mort], `${mort} subsiste en ${langue}`).toBeUndefined();
      }
    }
  });

  it("et les nouveaux libelles existent partout", () => {
    for (const langue of ["fr", "en", "es", "de", "tr", "ar"]) {
      const json = JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "i18n", "locales", `${langue}.json`), "utf8"),
      );
      const app = json.settingsSecurite?.app ?? {};
      for (const cle of ["rgpdEnPlace", "rgpdVoirDetail", "revokeSessionsConfirm", "revokeSessionsDone", "revokeSessionsFailed"]) {
        expect(app[cle], `libelle manquant en ${langue}: ${cle}`).toBeTruthy();
      }
    }
  });
});
