/**
 * Trois defauts d'ecran, de la meme famille : un etat garde d'un enregistrement
 * a l'autre.
 *
 * 1. `organisations.tsx` — ouvrir la facturation ou le dossier juridique d'une
 *    organisation n'effacait pas ce qui avait ete charge pour la PRECEDENTE.
 *    Quand la lecture echouait, les factures ou les documents d'avant
 *    restaient affiches sous le nom de la nouvelle, et les actions — accepter
 *    un document, agir sur une facture — portaient sur eux.
 *
 * 2. `users.tsx` — le formulaire d'edition initialisait le telephone a `""`,
 *    et le serveur applique tout champ different de `undefined` : chaque
 *    modification d'un utilisateur EFFACAIT son numero. La liste ne renvoyait
 *    d'ailleurs pas ce champ, donc l'ecran ne pouvait pas le pre-remplir.
 *
 * 3. `organisations.tsx` — le montant en tete d'une facture affichait
 *    `totalAmount`, qui est le HORS TAXES (le schema le dit explicitement) :
 *    20 % de moins que la somme reclamee.
 *
 * Ces controles lisent la SOURCE. Ils ne prouvent pas le rendu, mais ils
 * verrouillent exactement les lignes qui portaient le defaut — et le sabotage
 * les fait tomber.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dirname, "..");
const organisations = readFileSync(join(src, "pages", "organisations.tsx"), "utf8");
const utilisateurs = readFileSync(join(src, "pages", "users.tsx"), "utf8");
const authServeur = readFileSync(
  join(src, "..", "..", "api-server", "src", "routes", "auth.ts"), "utf8",
);

describe("les fenetres ne gardent plus l'organisation precedente", () => {
  const ouvrirFacturation = organisations.slice(
    organisations.indexOf("const openBilling"),
    organisations.indexOf("const handleCreate"),
  );
  const ouvrirJuridique = organisations.slice(
    organisations.indexOf("const openLegalDetail"),
    organisations.indexOf("const handleAcceptDocument"),
  );

  it("la facturation efface les factures d'avant", () => {
    expect(
      ouvrirFacturation,
      "sinon les factures d'une autre entreprise s'affichent sous ce nom",
    ).toMatch(/setOrgBilling\(null\)/);
  });

  it("le dossier juridique efface les documents d'avant", () => {
    expect(ouvrirJuridique).toMatch(/setLegalDetailDocs\(\[\]\)/);
  });

  it("une lecture qui echoue est signalee, pas silencieuse", () => {
    expect(ouvrirFacturation).toMatch(/setBillingErreur\(true\)/);
    expect(ouvrirJuridique).toMatch(/setLegalDetailErreur\(true\)/);
  });

  it("le `else` manquant sur `res.ok` est comble des deux cotes", () => {
    // C'est lui qui laissait l'ancien contenu en place sans rien dire.
    expect(ouvrirFacturation).toMatch(/\}\s*else\s*\{/);
    expect(ouvrirJuridique).toMatch(/\}\s*else\s*\{/);
  });

  it("l'ecran a de quoi afficher cet echec", () => {
    expect(organisations).toMatch(/chargementEchoue/);
  });
});

describe("modifier un utilisateur n'efface plus son telephone", () => {
  it("le formulaire part du numero existant", () => {
    expect(
      utilisateurs,
      "initialise a « », il etait envoye vide — et le serveur l'appliquait",
    ).not.toMatch(/departement: user\.departement \|\| "", telephone: "" \}/);
  });

  it("il le lit sur l'utilisateur", () => {
    expect(utilisateurs).toMatch(/telephone: user\.telephone \|\| ""/);
  });

  it("le type de l'ecran connait ce champ", () => {
    expect(utilisateurs).toMatch(/telephone: string \| null;/);
  });

  it("et la liste du serveur le renvoie enfin", () => {
    // Sans cela, l'ecran n'a rien a pre-remplir: le correctif cote client
    // seul ne suffirait pas.
    const liste = authServeur.slice(
      authServeur.indexOf("const users = await db.select({"),
      authServeur.indexOf("res.json({ users, total: users.length });"),
    );
    expect(liste).toMatch(/telephone: usersTable\.telephone/);
  });
});

describe("le montant d'une facture est celui qui est reclame", () => {
  it("le hors taxes n'est plus affiche en tete", () => {
    const enTete = organisations.slice(
      organisations.indexOf("Le montant en tete est ce que le client DOIT"),
      organisations.indexOf("billingDialog.forfait"),
    );
    expect(enTete, "le HT montre 20 % de moins que la somme reclamee").toMatch(/inv\.totalTtc/);
  });

  it("les factures anterieures a la TVA restent lisibles", () => {
    // Leur `totalTtc` vaut zero: afficher zero serait un autre mensonge.
    expect(organisations).toMatch(/Number\(inv\.totalTtc \?\? 0\) > 0 \? Number\(inv\.totalTtc\) : Number\(inv\.totalAmount\)/);
  });

  it("le type porte la distinction, pour qu'elle ne se reperde pas", () => {
    expect(organisations).toMatch(/Total HORS TAXES/);
    expect(organisations).toMatch(/totalTtc\?: string;/);
  });
});

describe("modifier ne vide plus les champs qu'on n'a pas touches", () => {
  const devis = readFileSync(join(src, "pages", "admin-devis.tsx"), "utf8");
  const facturesB2b = readFileSync(join(src, "pages", "admin-factures-b2b.tsx"), "utf8");

  /** Le corps de `openEdit`, la ou les champs sont pre-remplis. */
  function ouvertureEdition(source: string): string {
    const debut = source.indexOf("const openEdit = ");
    return source.slice(debut, source.indexOf("setDialogOpen(true);", debut));
  }

  it("les notes d'un devis sont reprises, pas remises a zero", () => {
    expect(
      ouvertureEdition(devis),
      "envoyees vides, elles etaient appliquees: modifier un devis effacait ses notes",
    ).toMatch(/notes: d\.notes \?\? ""/);
  });

  it("celles d'une facture B2B aussi", () => {
    expect(ouvertureEdition(facturesB2b)).toMatch(/notes: f\.notes \?\? ""/);
  });

  it("plus aucune de ces deux ouvertures ne met un champ a « » sans raison", () => {
    for (const [nom, source] of [["devis", devis], ["factures B2B", facturesB2b]] as const) {
      expect(ouvertureEdition(source), `${nom}: un champ remis a zero a l'ouverture`)
        .not.toMatch(/notes: "",/);
    }
  });

  it("les types portent le champ, sinon il n'y aurait rien a reprendre", () => {
    expect(devis).toMatch(/notes\?: string \| null;/);
    expect(facturesB2b).toMatch(/notes\?: string \| null;/);
  });

  it("et le serveur applique bien ce champ — c'est ce qui rendait l'oubli couteux", () => {
    const routeDevis = readFileSync(
      join(src, "..", "..", "api-server", "src", "routes", "devis.ts"), "utf8",
    );
    expect(routeDevis).toMatch(/"notes"/);
    expect(routeDevis).toMatch(/if \(b\[k\] !== undefined\) updates\[k\] = b\[k\];/);
  });
});

describe("le hook de selection est appele inconditionnellement", () => {
  /**
   * Premiere version cablee apres le retour anticipe de deux ecrans.
   *
   * React exige le MEME ordre de hooks a chaque rendu : appele apres un
   * `if (loading) return ...`, `useSelectionVisible` n'existait pas pendant le
   * chargement puis apparaissait ensuite, ce qui decale tous les hooks suivants
   * — etats melanges, effets rejoues. ESLint l'a vu (`rules-of-hooks`) avant
   * que le symptome n'apparaisse ; ce controle garde le point acquis.
   */
  const ECRANS = ["automations", "users", "contacts", "messages", "calls", "tasks", "projets"];

  for (const nom of ECRANS) {
    it(`${nom}: l'appel precede tout retour anticipe`, () => {
      const source = readFileSync(join(src, "pages", `${nom}.tsx`), "utf8");
      const appel = source.indexOf("useSelectionVisible(");
      expect(appel, `${nom} n'appelle pas le hook`).toBeGreaterThan(0);

      const retourAnticipe = source.search(/^\s{2}if \([^)]*\) \{\r?\n\s+return \(/m);
      if (retourAnticipe < 0) return; // pas de retour anticipe: rien a garder
      expect(
        appel,
        `${nom}: hook appele apres un retour anticipe — React exige le meme ordre a chaque rendu`,
      ).toBeLessThan(retourAnticipe);
    });
  }
});

describe("« ne pas relancer ce client » est enfin atteignable", () => {
  const contacts = readFileSync(join(src, "pages", "contacts.tsx"), "utf8");

  it("la case existe dans la fiche", () => {
    expect(
      contacts,
      "la garde existait cote serveur, mais aucun ecran ne permettait de l'activer",
    ).toMatch(/contacts\.form\.relancesRefusees/);
  });

  it("elle est pre-remplie depuis le contact", () => {
    expect(contacts).toMatch(/setRelancesRefusees\(!!contact\.relancesAutoDesactivees\)/);
  });

  it("elle passe par la route dediee, pas par le formulaire", () => {
    // Une volonte exprimee par un client se consigne par un acte explicite,
    // pas au detour d'un changement d'adresse.
    expect(contacts).toMatch(/\/demarchage/);
    expect(contacts).toMatch(/corps.relancesAuto = !relancesRefusees/);
  });

  it("elle n'est envoyee que si elle a change", () => {
    // La route refuse un corps vide, et l'ecrire a chaque enregistrement
    // brouillerait la trace.
    expect(contacts).toMatch(/!!editingContact\.relancesAutoDesactivees !== relancesRefusees/);
  });

  it("un echec d'enregistrement est dit", () => {
    expect(contacts).toMatch(/contacts\.toast\.relancesError/);
  });

  it("la case n'apparait qu'en modification", () => {
    // A la creation, le contact n'existe pas encore: la route dediee n'aurait
    // rien a modifier.
    expect(contacts).toMatch(/\{editingContact && \(/);
  });
});

describe("le regime de prospection est enfin renseignable", () => {
  const contacts = readFileSync(join(src, "pages", "contacts.tsx"), "utf8");
  const service = readFileSync(
    join(src, "..", "..", "api-server", "src", "services", "demarchage.ts"), "utf8",
  );

  it("la regle existe bien cote serveur — c'est son entree qui manquait", () => {
    expect(service, "si la regle disparaissait, cet ecran n'aurait plus d'objet")
      .toMatch(/2025-594/);
  });

  it("le type de personne se choisit", () => {
    // Sans lui, chaque fiche restait « inconnu », donc traitee comme un
    // particulier sans consentement: la regle etait juste et inapplicable.
    expect(contacts).toMatch(/contacts\.form\.typePersonne/);
    expect(contacts).toMatch(/value="professionnel"/);
  });

  it("le consentement aussi", () => {
    expect(contacts).toMatch(/contacts\.form\.consentement/);
    expect(contacts).toMatch(/value="accorde"/);
  });

  it("l'opposition aussi", () => {
    expect(contacts).toMatch(/contacts\.form\.opposition/);
  });

  it("les trois champs sont pre-remplis depuis la fiche", () => {
    expect(contacts).toMatch(/setTypePersonne\(contact\.typePersonne \|\| "inconnu"\)/);
    expect(contacts).toMatch(/setConsentement\(contact\.prospectionConsent \|\| "inconnu"\)/);
    expect(contacts).toMatch(/setOpposition\(!!contact\.prospectionOppositionAt\)/);
  });

  it("seuls les champs modifies sont envoyes", () => {
    // Reecrire un consentement inchange remettrait sa DATE a jour — or c'est
    // la date qui fait la preuve.
    expect(contacts).toMatch(/if \(\(editingContact\.prospectionConsent \|\| "inconnu"\) !== consentement\)/);
    expect(contacts).toMatch(/if \(Object\.keys\(corps\)\.length > 0\)/);
  });

  it("tout passe par la route dediee, en un seul appel", () => {
    const envois = contacts.match(/await fetch\([^)]*\/demarchage/g) ?? [];
    expect(envois.length, "un appel par champ multiplierait les traces").toBe(1);
  });
});

describe("un etat qu'on n'a pas pu lire n'est pas un etat connu", () => {
  const plateformes = readFileSync(join(src, "pages", "settings", "tab-plateformes.tsx"), "utf8");

  it("l'echec de la lecture est retenu", () => {
    // `configured` restait a false quand la lecture echouait, et tout le bloc
    // de connexion Google disparaissait: l'utilisateur ne voyait meme pas que
    // Google est configurable.
    expect(plateformes).toMatch(/setGoogleStatutIllisible\(true\)/);
  });

  it("aussi bien sur un refus du serveur que sur une erreur reseau", () => {
    const occurrences = plateformes.match(/setGoogleStatutIllisible\(true\)/g) ?? [];
    expect(occurrences.length, "les deux chemins d'echec doivent le dire").toBe(2);
  });

  it("une lecture reussie efface l'avertissement", () => {
    expect(plateformes).toMatch(/setGoogleStatutIllisible\(false\)/);
  });

  it("l'ecran a de quoi l'afficher", () => {
    expect(plateformes).toMatch(/settingsPlateformes\.google\.statutIllisible/);
  });
});
